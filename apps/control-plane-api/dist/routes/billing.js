"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingRoutes = billingRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const guards_js_1 = require("../guards.js");
async function billingRoutes(fastify) {
    fastify.post('/budget/check', async (request, reply) => {
        const { orgId, requiredTokens } = request.body;
        const budget = await shared_db_1.db.query.tokenBudgets.findFirst({
            where: (0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, orgId)
        });
        if (!budget) {
            const [newBudget] = await shared_db_1.db.insert(shared_db_2.tokenBudgets).values({
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
    fastify.post('/budget/consume', async (request, reply) => {
        const { orgId, serviceId, jobId, tokensUsed, model, purpose } = request.body;
        let costUsd = null;
        if (model) {
            const pricing = await shared_db_1.db.query.modelPricing.findFirst({
                where: (0, shared_db_1.eq)(shared_db_2.modelPricing.model, model),
            });
            if (pricing) {
                const avgCostPer1m = (Number(pricing.inputCostPer1m) + Number(pricing.outputCostPer1m)) / 2;
                costUsd = ((tokensUsed / 1_000_000) * avgCostPer1m).toFixed(6);
            }
        }
        await shared_db_1.db.transaction(async (tx) => {
            await tx.update(shared_db_2.tokenBudgets)
                .set({
                remainingTokens: (0, shared_db_1.sql) `${shared_db_2.tokenBudgets.remainingTokens} - ${tokensUsed}`,
                updatedAt: new Date()
            })
                .where((0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, orgId));
            await tx.insert(shared_db_2.tokenUsageLogs).values({
                orgId,
                serviceId: serviceId || null,
                jobId: jobId || null,
                tokensUsed,
                model,
                purpose,
                costUsd,
            });
            if (tokensUsed > 1000) {
                await tx.insert(shared_db_2.auditLogs).values({
                    orgId,
                    action: 'token.consumed',
                    payload: JSON.stringify({ tokensUsed, purpose, model, jobId }),
                });
            }
        });
        return { success: true };
    });
    fastify.get('/usage', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        const targetOrgId = session.roles.includes('super_admin') && request.query?.orgId
            ? request.query.orgId
            : session.orgId;
        let budget = await shared_db_1.db.query.tokenBudgets.findFirst({
            where: (0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, targetOrgId)
        });
        if (!budget) {
            const [newBudget] = await shared_db_1.db.insert(shared_db_2.tokenBudgets).values({
                orgId: targetOrgId,
                totalTokens: 100000,
                remainingTokens: 100000,
            }).returning();
            budget = newBudget;
        }
        const recentLogs = await shared_db_1.db.query.tokenUsageLogs.findMany({
            where: (0, shared_db_1.eq)(shared_db_2.tokenUsageLogs.orgId, targetOrgId),
            orderBy: (logs, { desc }) => [desc(logs.createdAt)],
            limit: 50
        });
        const [costRow] = await shared_db_1.db
            .select({ totalCost: (0, shared_db_1.sql) `COALESCE(SUM(${shared_db_2.tokenUsageLogs.costUsd}::numeric), 0)` })
            .from(shared_db_2.tokenUsageLogs)
            .where((0, shared_db_1.eq)(shared_db_2.tokenUsageLogs.orgId, targetOrgId));
        return {
            budget,
            recentLogs,
            totalCostUsd: Number(costRow?.totalCost ?? 0),
        };
    });
    fastify.patch('/budget/limit', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        const targetOrgId = session.roles.includes('super_admin') && request.body?.orgId
            ? request.body.orgId
            : session.orgId;
        const { totalTokens, resetRemaining } = request.body;
        if (!totalTokens || typeof totalTokens !== 'number' || totalTokens < 1) {
            return reply.status(400).send({ error: 'totalTokens must be a positive number' });
        }
        const existing = await shared_db_1.db.query.tokenBudgets.findFirst({
            where: (0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, targetOrgId)
        });
        if (existing) {
            const updates = { totalTokens, updatedAt: new Date() };
            if (resetRemaining) {
                updates.remainingTokens = totalTokens;
            }
            else {
                updates.remainingTokens = Math.min(existing.remainingTokens, totalTokens);
            }
            const [updated] = await shared_db_1.db.update(shared_db_2.tokenBudgets)
                .set(updates)
                .where((0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, targetOrgId))
                .returning();
            await shared_db_1.db.insert(shared_db_2.auditLogs).values({
                orgId: targetOrgId,
                userId: session.userId,
                actorType: 'user',
                action: 'billing.limit_updated',
                resourceType: 'token_budget',
                resourceId: existing.id,
                payload: JSON.stringify({ totalTokens, resetRemaining }),
            });
            return updated;
        }
        else {
            const [created] = await shared_db_1.db.insert(shared_db_2.tokenBudgets).values({
                orgId: targetOrgId,
                totalTokens,
                remainingTokens: totalTokens,
            }).returning();
            return created;
        }
    });
    fastify.post('/webhook', async (request, reply) => {
        const payload = request.body;
        const type = payload.type;
        console.log(`[Stripe Webhook] Received event: ${type}`);
        try {
            if (type === 'checkout.session.completed') {
                const session = payload.data.object;
                const orgId = session.metadata?.orgId;
                const plan = session.metadata?.plan || 'pro';
                if (orgId) {
                    await shared_db_1.db.update(shared_db_2.organizations)
                        .set({
                        plan: plan,
                        billingCustomerId: session.customer,
                        subscriptionId: session.subscription,
                        updatedAt: new Date()
                    })
                        .where((0, shared_db_1.eq)(shared_db_2.organizations.id, orgId));
                    const tokenAmount = plan === 'pro' ? 1000000 : (plan === 'enterprise' ? 10000000 : 500000);
                    await shared_db_1.db.update(shared_db_2.tokenBudgets)
                        .set({
                        totalTokens: tokenAmount,
                        remainingTokens: tokenAmount,
                        updatedAt: new Date(),
                        resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    })
                        .where((0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, orgId));
                    await shared_db_1.db.insert(shared_db_2.auditLogs).values({
                        orgId,
                        action: 'billing.plan_upgraded',
                        payload: JSON.stringify({ plan, customerId: session.customer }),
                    });
                }
            }
            if (type === 'invoice.paid') {
                const invoice = payload.data.object;
                const customerId = invoice.customer;
                const [org] = await shared_db_1.db.select().from(shared_db_2.organizations).where((0, shared_db_1.eq)(shared_db_2.organizations.billingCustomerId, customerId)).limit(1);
                if (org) {
                    const tokenAmount = org.plan === 'pro' ? 1000000 : (org.plan === 'enterprise' ? 10000000 : 100000);
                    await shared_db_1.db.update(shared_db_2.tokenBudgets)
                        .set({ remainingTokens: tokenAmount, updatedAt: new Date() })
                        .where((0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, org.id));
                }
            }
            return { received: true };
        }
        catch (err) {
            console.error(`[Stripe Webhook] Error:`, err);
            return reply.status(500).send({ error: 'Webhook processing failed' });
        }
    });
}
//# sourceMappingURL=billing.js.map