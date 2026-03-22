"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingRoutes = billingRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
const schema = __importStar(require("@ecom-kit/shared-db"));
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const guards_js_1 = require("../guards.js");
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = (0, postgres_1.default)(connectionString);
const db = (0, postgres_js_1.drizzle)(client, { schema });
async function billingRoutes(fastify) {
    // Check token budget BEFORE starting AI task
    // Internal endpoint called by Service Plane
    fastify.post('/budget/check', async (request, reply) => {
        const { orgId, requiredTokens } = request.body;
        const budget = await db.query.tokenBudgets.findFirst({
            where: (0, drizzle_orm_1.eq)(shared_db_1.tokenBudgets.orgId, orgId)
        });
        if (!budget) {
            // Create default free budget if missing
            const [newBudget] = await db.insert(shared_db_1.tokenBudgets).values({
                orgId,
                totalTokens: 100000,
                remainingTokens: 100000,
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
        const { orgId, serviceId, jobId, tokensUsed, model, purpose } = request.body;
        await db.transaction(async (tx) => {
            // 1. Deduct from budget
            await tx.update(shared_db_1.tokenBudgets)
                .set({
                remainingTokens: (0, drizzle_orm_1.sql) `${shared_db_1.tokenBudgets.remainingTokens} - ${tokensUsed}`,
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.eq)(shared_db_1.tokenBudgets.orgId, orgId));
            // 2. Log usage
            await tx.insert(shared_db_1.tokenUsageLogs).values({
                orgId,
                serviceId: serviceId || null,
                jobId: jobId || null,
                tokensUsed,
                model,
                purpose,
            });
            // 3. Audit log if significant
            if (tokensUsed > 1000) {
                await tx.insert(shared_db_1.auditLogs).values({
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
        preHandler: [(0, guards_js_1.requirePermission)('organization:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        let budget = await db.query.tokenBudgets.findFirst({
            where: (0, drizzle_orm_1.eq)(shared_db_1.tokenBudgets.orgId, session.orgId)
        });
        if (!budget) {
            const [newBudget] = await db.insert(shared_db_1.tokenBudgets).values({
                orgId: session.orgId,
                totalTokens: 100000,
                remainingTokens: 100000,
            }).returning();
            budget = newBudget;
        }
        const recentLogs = await db.query.tokenUsageLogs.findMany({
            where: (0, drizzle_orm_1.eq)(shared_db_1.tokenUsageLogs.orgId, session.orgId),
            orderBy: (logs, { desc }) => [desc(logs.createdAt)],
            limit: 50
        });
        return {
            budget,
            recentLogs
        };
    });
    // Stripe Webhook Endpoint (MOCKED for design)
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
                    await db.update(shared_db_1.organizations)
                        .set({
                        plan: plan,
                        billingCustomerId: session.customer,
                        subscriptionId: session.subscription,
                        updatedAt: new Date()
                    })
                        .where((0, drizzle_orm_1.eq)(shared_db_1.organizations.id, orgId));
                    // Top up tokens for the new plan
                    const tokenAmount = plan === 'pro' ? 1000000 : (plan === 'enterprise' ? 10000000 : 500000);
                    await db.update(shared_db_1.tokenBudgets)
                        .set({
                        totalTokens: tokenAmount,
                        remainingTokens: tokenAmount,
                        updatedAt: new Date(),
                        resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    })
                        .where((0, drizzle_orm_1.eq)(shared_db_1.tokenBudgets.orgId, orgId));
                    await db.insert(shared_db_1.auditLogs).values({
                        orgId,
                        action: 'billing.plan_upgraded',
                        payload: JSON.stringify({ plan, customerId: session.customer }),
                    });
                }
            }
            if (type === 'invoice.paid') {
                const invoice = payload.data.object;
                const customerId = invoice.customer;
                const [org] = await db.select().from(shared_db_1.organizations).where((0, drizzle_orm_1.eq)(shared_db_1.organizations.billingCustomerId, customerId)).limit(1);
                if (org) {
                    const tokenAmount = org.plan === 'pro' ? 1000000 : (org.plan === 'enterprise' ? 10000000 : 100000);
                    await db.update(shared_db_1.tokenBudgets)
                        .set({ remainingTokens: tokenAmount, updatedAt: new Date() })
                        .where((0, drizzle_orm_1.eq)(shared_db_1.tokenBudgets.orgId, org.id));
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