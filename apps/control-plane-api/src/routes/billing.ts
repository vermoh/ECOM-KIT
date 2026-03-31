import { FastifyInstance } from 'fastify';
import { eq, sql, db } from '@ecom-kit/shared-db';
import { tokenBudgets, tokenUsageLogs, auditLogs, organizations } from '@ecom-kit/shared-db';
import * as schema from '@ecom-kit/shared-db';
import { requirePermission } from '../guards.js';

export async function billingRoutes(fastify: FastifyInstance) {
  
  // Check token budget BEFORE starting AI task
  // Internal endpoint called by Service Plane
  fastify.post('/budget/check', async (request, reply) => {
    const { orgId, requiredTokens } = request.body as { orgId: string, requiredTokens: number };

    const budget = await db.query.tokenBudgets.findFirst({
      where: eq(tokenBudgets.orgId, orgId)
    });

    if (!budget) {
      // Create default free budget if missing
      const [newBudget] = await db.insert(tokenBudgets).values({
        orgId,
        totalTokens: 10000000,
        remainingTokens: 10000000,
      }).returning();
      
      return { 
        canProceed: newBudget.remainingTokens >= requiredTokens,
        remainingTokens: newBudget.remainingTokens
      };
    }

    return {
      canProceed: budget.remainingTokens >= requiredTokens,
      remainingTokens: budget.remainingTokens
    };
  });

  // Record token consumption AFTER AI task completes
  // Internal endpoint called by Service Plane
  fastify.post('/budget/consume', async (request, reply) => {
    const { orgId, serviceId, jobId, tokensUsed, model, purpose } = request.body as any;

    await db.transaction(async (tx) => {
      // 1. Deduct from budget
      await tx.update(tokenBudgets)
        .set({ 
          remainingTokens: sql`${tokenBudgets.remainingTokens} - ${tokensUsed}`,
          updatedAt: new Date()
        })
        .where(eq(tokenBudgets.orgId, orgId));

      // 2. Log usage
      await tx.insert(tokenUsageLogs).values({
        orgId,
        serviceId: serviceId || null,
        jobId: jobId || null,
        tokensUsed,
        model,
        purpose,
      });

      // 3. Audit log if significant
      if (tokensUsed > 1000) {
        await tx.insert(auditLogs).values({
          orgId,
          action: 'token.consumed',
          payload: JSON.stringify({ tokensUsed, purpose, model, jobId }),
        });
      }
    });

    return { success: true };
  });

  // Get current usage metrics for dashboard
  fastify.get('/usage', {
    preHandler: [requirePermission('organization:read')]
  }, async (request, reply) => {
    const session = request.userSession!;
    
    let budget = await db.query.tokenBudgets.findFirst({
      where: eq(tokenBudgets.orgId, session.orgId)
    });

    if (!budget) {
        const [newBudget] = await db.insert(tokenBudgets).values({
            orgId: session.orgId,
            totalTokens: 100000,
            remainingTokens: 100000,
          }).returning();
        budget = newBudget;
    }

    const recentLogs = await db.query.tokenUsageLogs.findMany({
      where: eq(tokenUsageLogs.orgId, session.orgId),
      orderBy: (logs: any, { desc }: any) => [desc(logs.createdAt)],
      limit: 50
    });

    return {
      budget,
      recentLogs
    };
  });

  // Update token budget limit for an organization
  fastify.patch('/budget/limit', {
    preHandler: [requirePermission('organization:read')]
  }, async (request, reply) => {
    const session = request.userSession!;
    const { totalTokens, resetRemaining } = request.body as { totalTokens: number; resetRemaining?: boolean };

    if (!totalTokens || typeof totalTokens !== 'number' || totalTokens < 1) {
      return reply.status(400).send({ error: 'totalTokens must be a positive number' });
    }

    const existing = await db.query.tokenBudgets.findFirst({
      where: eq(tokenBudgets.orgId, session.orgId)
    });

    if (existing) {
      const updates: any = { totalTokens, updatedAt: new Date() };
      if (resetRemaining) {
        updates.remainingTokens = totalTokens;
      } else {
        // Keep remaining proportional — don't let it exceed new total
        updates.remainingTokens = Math.min(existing.remainingTokens, totalTokens);
      }
      const [updated] = await db.update(tokenBudgets)
        .set(updates)
        .where(eq(tokenBudgets.orgId, session.orgId))
        .returning();

      await db.insert(auditLogs).values({
        orgId: session.orgId,
        actorId: session.userId,
        actorType: 'user',
        action: 'billing.limit_updated',
        resourceType: 'token_budget',
        resourceId: existing.id,
        payload: JSON.stringify({ totalTokens, resetRemaining }),
      });

      return updated;
    } else {
      const [created] = await db.insert(tokenBudgets).values({
        orgId: session.orgId,
        totalTokens,
        remainingTokens: totalTokens,
      }).returning();
      return created;
    }
  });

  // Stripe Webhook Endpoint (MOCKED for design)
  fastify.post('/webhook', async (request, reply) => {
    const payload = request.body as any;
    const type = payload.type;

    console.log(`[Stripe Webhook] Received event: ${type}`);

    try {
      if (type === 'checkout.session.completed') {
        const session = payload.data.object;
        const orgId = session.metadata?.orgId;
        const plan = session.metadata?.plan || 'pro';

        if (orgId) {
          await db.update(organizations)
            .set({ 
              plan: plan as any, 
              billingCustomerId: session.customer, 
              subscriptionId: session.subscription,
              updatedAt: new Date() 
            })
            .where(eq(organizations.id, orgId));

          // Top up tokens for the new plan
          const tokenAmount = plan === 'pro' ? 1000000 : (plan === 'enterprise' ? 10000000 : 500000);
          await db.update(tokenBudgets)
            .set({ 
                totalTokens: tokenAmount, 
                remainingTokens: tokenAmount, 
                updatedAt: new Date(),
                resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            })
            .where(eq(tokenBudgets.orgId, orgId));

          await db.insert(auditLogs).values({
            orgId,
            action: 'billing.plan_upgraded',
            payload: JSON.stringify({ plan, customerId: session.customer }),
          });
        }
      }

      if (type === 'invoice.paid') {
         const invoice = payload.data.object;
         const customerId = invoice.customer;
         
         const [org] = await db.select().from(organizations).where(eq(organizations.billingCustomerId, customerId)).limit(1);
         if (org) {
             const tokenAmount = org.plan === 'pro' ? 1000000 : (org.plan === 'enterprise' ? 10000000 : 100000);
             await db.update(tokenBudgets)
                .set({ remainingTokens: tokenAmount, updatedAt: new Date() })
                .where(eq(tokenBudgets.orgId, org.id));
         }
      }

      return { received: true };
    } catch (err) {
      console.error(`[Stripe Webhook] Error:`, err);
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }
  });
}
