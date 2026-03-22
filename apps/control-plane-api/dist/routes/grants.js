"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantRoutes = grantRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const guards_js_1 = require("../guards.js");
const node_crypto_1 = __importDefault(require("node:crypto"));
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = (0, postgres_1.default)(connectionString);
const db = (0, postgres_js_1.drizzle)(client);
async function grantRoutes(fastify) {
    // Issue an AccessGrant (service token)
    // This is typically called by a UI component or a service that needs to delegate work
    fastify.post('/issue', {
        preHandler: [(0, guards_js_1.requirePermission)('enrichment:start')] // Example permission that might need a grant
    }, async (request, reply) => {
        const session = request.userSession;
        const { serviceSlug, scopes } = request.body;
        // 1. Find service
        const [service] = await db.select().from(shared_db_1.services).where((0, drizzle_orm_1.eq)(shared_db_1.services.slug, serviceSlug)).limit(1);
        if (!service) {
            return reply.status(404).send({ error: 'SERVICE_NOT_FOUND' });
        }
        // 2. Verify org has access to this service
        const [access] = await db.select().from(shared_db_1.serviceAccess).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.serviceAccess.orgId, session.orgId), (0, drizzle_orm_1.eq)(shared_db_1.serviceAccess.serviceId, service.id), (0, drizzle_orm_1.eq)(shared_db_1.serviceAccess.enabled, true))).limit(1);
        if (!access) {
            return reply.status(403).send({ error: 'SERVICE_ACCESS_DENIED' });
        }
        // 3. Generate random token
        const rawToken = node_crypto_1.default.randomBytes(32).toString('hex');
        const tokenHash = node_crypto_1.default.createHash('sha256').update(rawToken).digest('hex');
        // 4. Store grant
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL
        const [grant] = await db.insert(shared_db_1.accessGrants).values({
            orgId: session.orgId,
            serviceId: service.id,
            tokenHash,
            scopes: scopes || [],
            expiresAt,
        }).returning();
        await db.insert(shared_db_1.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'access_grant.issued',
            resourceType: 'access_grant',
            resourceId: grant.id,
            payload: JSON.stringify({ serviceSlug, scopes }),
        });
        // Return raw token ONLY once
        return {
            token: rawToken,
            expiresAt,
            grantId: grant.id
        };
    });
    // Verify an AccessGrant (called by services to validate tokens)
    fastify.post('/verify', async (request, reply) => {
        const { token } = request.body;
        if (!token) {
            return reply.status(400).send({ error: 'TOKEN_REQUIRED' });
        }
        const tokenHash = node_crypto_1.default.createHash('sha256').update(token).digest('hex');
        const [grant] = await db.select().from(shared_db_1.accessGrants).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.accessGrants.tokenHash, tokenHash), (0, drizzle_orm_1.isNull)(shared_db_1.accessGrants.revokedAt))).limit(1);
        // Manual date check because some DBs/drivers might be weird with 'now()'
        if (!grant || grant.expiresAt < new Date() || grant.revokedAt !== null) {
            return reply.status(401).send({ error: 'INVALID_OR_EXPIRED_GRANT' });
        }
        return {
            valid: true,
            orgId: grant.orgId,
            serviceId: grant.serviceId,
            scopes: grant.scopes
        };
    });
}
//# sourceMappingURL=grants.js.map