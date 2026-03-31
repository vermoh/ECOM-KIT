"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerRoutes = providerRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const guards_js_1 = require("../guards.js");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const node_crypto_1 = __importDefault(require("node:crypto"));
const MASTER_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
async function providerRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('secret:read_hint')]
    }, async (request, reply) => {
        const session = request.userSession;
        const configs = await shared_db_1.db.select({
            id: shared_db_2.providerConfigs.id,
            orgId: shared_db_2.providerConfigs.orgId,
            provider: shared_db_2.providerConfigs.provider,
            keyHint: shared_db_2.providerConfigs.keyHint,
            rotatedAt: shared_db_2.providerConfigs.rotatedAt,
            createdAt: shared_db_2.providerConfigs.createdAt
        })
            .from(shared_db_2.providerConfigs)
            .where((0, shared_db_1.eq)(shared_db_2.providerConfigs.orgId, session.orgId));
        return configs;
    });
    fastify.post('/', {
        preHandler: [(0, guards_js_1.requirePermission)('secret:create')]
    }, async (request, reply) => {
        const session = request.userSession;
        const { provider, value } = request.body;
        if (!provider || !value) {
            return reply.status(400).send({ error: 'PROVIDER_AND_VALUE_REQUIRED' });
        }
        const encryptedValue = (0, shared_auth_1.encrypt)(value, MASTER_KEY);
        const keyHint = value.slice(-4);
        const [newConfig] = await shared_db_1.db.insert(shared_db_2.providerConfigs).values({
            orgId: session.orgId,
            provider,
            encryptedValue,
            keyHint,
            createdBy: session.userId,
        }).returning({
            id: shared_db_2.providerConfigs.id,
            provider: shared_db_2.providerConfigs.provider,
            keyHint: shared_db_2.providerConfigs.keyHint
        });
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'secret.create',
            resourceType: 'provider_config',
            resourceId: newConfig.id,
            payload: JSON.stringify({ provider, key_hint: keyHint }),
        });
        return newConfig;
    });
    fastify.post('/rotate/:id', {
        preHandler: [(0, guards_js_1.requirePermission)('secret:rotate')]
    }, async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const { value } = request.body;
        if (!value) {
            return reply.status(400).send({ error: 'VALUE_REQUIRED' });
        }
        const encryptedValue = (0, shared_auth_1.encrypt)(value, MASTER_KEY);
        const keyHint = value.slice(-4);
        const [updated] = await shared_db_1.db.update(shared_db_2.providerConfigs)
            .set({
            encryptedValue,
            keyHint,
            rotatedAt: new Date(),
        })
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.providerConfigs.id, id), (0, shared_db_1.eq)(shared_db_2.providerConfigs.orgId, session.orgId)))
            .returning({
            id: shared_db_2.providerConfigs.id,
            provider: shared_db_2.providerConfigs.provider,
            keyHint: shared_db_2.providerConfigs.keyHint
        });
        if (!updated) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'secret.rotate',
            resourceType: 'provider_config',
            resourceId: id,
            payload: JSON.stringify({ key_hint: keyHint }),
        });
        return updated;
    });
    fastify.delete('/:id', {
        preHandler: [(0, guards_js_1.requirePermission)('secret:delete')]
    }, async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const [deleted] = await shared_db_1.db.delete(shared_db_2.providerConfigs)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.providerConfigs.id, id), (0, shared_db_1.eq)(shared_db_2.providerConfigs.orgId, session.orgId)))
            .returning();
        if (!deleted) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'secret.delete',
            resourceType: 'provider_config',
            resourceId: id,
        });
        return reply.status(204).send();
    });
    fastify.get('/key/:provider', async (request, reply) => {
        const { provider } = request.params;
        let orgId;
        if (request.userSession?.orgId) {
            if (!request.userSession.permissions?.includes('secret:read') && !request.userSession.permissions?.includes('*')) {
                return reply.status(403).send({ error: 'PERMISSION_DENIED', permission: 'secret:read' });
            }
            orgId = request.userSession.orgId;
        }
        else {
            const authHeader = request.headers['authorization'] || '';
            const token = authHeader.replace('Bearer ', '');
            if (!token) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            try {
                const tokenHash = node_crypto_1.default.createHash('sha256').update(token).digest('hex');
                const [grant] = await shared_db_1.db.select()
                    .from(shared_db_2.accessGrants)
                    .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.accessGrants.tokenHash, tokenHash), (0, shared_db_1.isNull)(shared_db_2.accessGrants.revokedAt)))
                    .limit(1);
                if (!grant || grant.expiresAt < new Date()) {
                    return reply.status(401).send({ error: 'INVALID_OR_EXPIRED_GRANT' });
                }
                if (!Array.isArray(grant.scopes) || !grant.scopes.includes('secret:read')) {
                    return reply.status(403).send({ error: 'PERMISSION_DENIED', permission: 'secret:read' });
                }
                orgId = grant.orgId;
            }
            catch (err) {
                console.error('[Providers] AccessGrant DB verify failed:', err);
                return reply.status(500).send({ error: 'GRANT_VERIFY_FAILED' });
            }
        }
        if (!orgId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const [config] = await shared_db_1.db.select()
            .from(shared_db_2.providerConfigs)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.providerConfigs.orgId, orgId), (0, shared_db_1.eq)(shared_db_2.providerConfigs.provider, provider)))
            .limit(1);
        if (!config) {
            return reply.status(404).send({ error: 'CONFIG_NOT_FOUND' });
        }
        const decryptedValue = (0, shared_auth_1.decrypt)(config.encryptedValue, MASTER_KEY);
        console.log(`[Providers] Key resolved for org ${orgId}, provider ${provider}, hint: ***${config.keyHint}`);
        return {
            provider: config.provider,
            value: decryptedValue
        };
    });
}
//# sourceMappingURL=providers.js.map