"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantRoutes = grantRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const guards_js_1 = require("../guards.js");
const node_crypto_1 = __importDefault(require("node:crypto"));
async function grantRoutes(fastify) {
    fastify.post('/issue', {
        preHandler: [(0, guards_js_1.requirePermission)('enrichment:start')]
    }, async (request, reply) => {
        const session = request.userSession;
        const { serviceSlug, scopes } = request.body;
        const [service] = await shared_db_1.db.select().from(shared_db_2.services).where((0, shared_db_1.eq)(shared_db_2.services.slug, serviceSlug)).limit(1);
        if (!service) {
            return reply.status(404).send({ error: 'SERVICE_NOT_FOUND' });
        }
        const [access] = await shared_db_1.db.select().from(shared_db_2.serviceAccess).where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.serviceAccess.orgId, session.orgId), (0, shared_db_1.eq)(shared_db_2.serviceAccess.serviceId, service.id), (0, shared_db_1.eq)(shared_db_2.serviceAccess.enabled, true))).limit(1);
        if (!access) {
            return reply.status(403).send({ error: 'SERVICE_ACCESS_DENIED' });
        }
        const rawToken = node_crypto_1.default.randomBytes(32).toString('hex');
        const tokenHash = node_crypto_1.default.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const [grant] = await shared_db_1.db.insert(shared_db_2.accessGrants).values({
            orgId: session.orgId,
            serviceId: service.id,
            tokenHash,
            scopes: scopes || [],
            expiresAt,
        }).returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'access_grant.issued',
            resourceType: 'access_grant',
            resourceId: grant.id,
            payload: JSON.stringify({ serviceSlug, scopes }),
        });
        return {
            token: rawToken,
            expiresAt,
            grantId: grant.id
        };
    });
    fastify.post('/verify', async (request, reply) => {
        const { token } = request.body;
        if (!token) {
            return reply.status(400).send({ error: 'TOKEN_REQUIRED' });
        }
        const tokenHash = node_crypto_1.default.createHash('sha256').update(token).digest('hex');
        const [grant] = await shared_db_1.db.select().from(shared_db_2.accessGrants).where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.accessGrants.tokenHash, tokenHash), (0, shared_db_1.isNull)(shared_db_2.accessGrants.revokedAt))).limit(1);
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