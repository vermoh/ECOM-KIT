import { FastifyInstance } from 'fastify';
import { eq, sql, db } from '@ecom-kit/shared-db';
import { tokenBudgets, tokenUsageLogs, auditLogs, organizations, modelPricing } from '@ecom-kit/shared-db';
import * as schema from '@ecom-kit/shared-db';
import { requirePermission } from '../guards.js';

const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';

function verifyServiceToken(request: any, reply: any): boolean {
  const authHeader = (request.headers['authorization'] as string) || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== SERVICE_TOKEN) {
    reply.status(401).send({ error: 'INVALID_SERVICE_TOKEN' });
    return false;
  }
  return true;
}

export async function billingRoutes(fastify: FastifyInstance) {

  // Check token budget BEFORE starting AI task
  // Internal endpoint called by Service Plane
  fastify.post('/budget/check', async (request, reply) => {
    if (!request.userSession && !verifyServiceToken(request, reply)) return;
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
    if (!request.userSession && !verifyServiceToken(request, reply)) return;
    const { orgId, serviceId, jobId, tokensUsed, model, purpose } = request.body as any;

    // Calculate cost from model pricing table
    let costUsd: string | null = null;
    if (model) {
      const pricing = await db.query.modelPricing.findFirst({
        where: eq(modelPricing.model, model),
      });
      if (pricing) {
        // Use average of input/output cost as approximation (no input/output split available)
        const avgCostPer1m = (Number(pricing.inputCostPer1m) + Number(pricing.outputCostPer1m)) / 2;
        costUsd = ((tokensUsed / 1_000_000) * avgCostPer1m).toFixed(6);
      }
    }

    await db.transaction(async (tx) => {
      // 1. Deduct from budget
      await tx.update(tokenBudgets)
        .set({
          remainingTokens: sql`${tokenBudgets.remainingTokens} - ${tokensUsed}`,
          updatedAt: new Date()
        })
        .where(eq(tokenBudgets.orgId, orgId));

      // 2. Log usage with cost
      await tx.insert(tokenUsageLogs).values({
        orgId,
        serviceId: serviceId || null,
        jobId: jobId || null,
        tokensUsed,
        model,
        purpose,
        costUsd,
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
    const targetOrgId = session.roles.includes('super_admin') && (request.query as any)?.orgId
      ? (request.query as any).orgId
      : session.orgId;

    let budget = await db.query.tokenBudgets.findFirst({
      where: eq(tokenBudgets.orgId, targetOrgId)
    });

    if (!budget) {
        const [newBudget] = await db.insert(tokenBudgets).values({
            orgId: targetOrgId,
            totalTokens: 100000,
            remainingTokens: 100000,
          }).returning();
        budget = newBudget;
    }

    const recentLogs = await db.query.tokenUsageLogs.findMany({
      where: eq(tokenUsageLogs.orgId, targetOrgId),
      orderBy: (logs: any, { desc }: any) => [desc(logs.createdAt)],
      limit: 50
    });

    // Aggregate total cost
    const [costRow] = await db
      .select({ totalCost: sql<string>`COALESCE(SUM(${tokenUsageLogs.costUsd}::numeric), 0)` })
      .from(tokenUsageLogs)
      .where(eq(tokenUsageLogs.orgId, targetOrgId));

    return {
      budget,
      recentLogs,
      totalCostUsd: Number(costRow?.totalCost ?? 0),
    };
  });

  // Update token budget limit for an organization
  fastify.patch('/budget/limit', {
    preHandler: [requirePermission('organization:read')]
  }, async (request, reply) => {
    const session = request.userSession!;
    const targetOrgId = session.roles.includes('super_admin') && (request.body as any)?.orgId
      ? (request.body as any).orgId
      : session.orgId;
    const { totalTokens, resetRemaining } = request.body as { totalTokens: number; resetRemaining?: boolean };

    if (!totalTokens || typeof totalTokens !== 'number' || totalTokens < 1) {
      return reply.status(400).send({ error: 'totalTokens must be a positive number' });
    }

    const existing = await db.query.tokenBudgets.findFirst({
      where: eq(tokenBudgets.orgId, targetOrgId)
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
        .where(eq(tokenBudgets.orgId, targetOrgId))
        .returning();

      await db.insert(auditLogs).values({
        orgId: targetOrgId,
        userId: session.userId,
        actorType: 'user',
        action: 'billing.limit_updated',
        resourceType: 'token_budget',
        resourceId: existing.id,
        payload: JSON.stringify({ totalTokens, resetRemaining }),
      });

      return updated;
    } else {
      const [created] = await db.insert(tokenBudgets).values({
        orgId: targetOrgId,
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
