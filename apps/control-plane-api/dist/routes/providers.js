"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerRoutes = providerRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const guards_js_1 = require("../guards.js");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = (0, postgres_1.default)(connectionString);
const db = (0, postgres_js_1.drizzle)(client);
// Master key for encryption (should be in env in production)
const MASTER_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
async function providerRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('secret:read_hint')]
    }, async (request, reply) => {
        const session = request.userSession;
        // RLS handles org isolation, but we explicitly filter by orgId for safety
        const configs = await db.select({
            id: shared_db_1.providerConfigs.id,
            orgId: shared_db_1.providerConfigs.orgId,
            provider: shared_db_1.providerConfigs.provider,
            keyHint: shared_db_1.providerConfigs.keyHint,
            rotatedAt: shared_db_1.providerConfigs.rotatedAt,
            createdAt: shared_db_1.providerConfigs.createdAt
        })
            .from(shared_db_1.providerConfigs)
            .where((0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.orgId, session.orgId));
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
        const [newConfig] = await db.insert(shared_db_1.providerConfigs).values({
            orgId: session.orgId,
            provider,
            encryptedValue,
            keyHint,
            createdBy: session.userId,
        }).returning({
            id: shared_db_1.providerConfigs.id,
            provider: shared_db_1.providerConfigs.provider,
            keyHint: shared_db_1.providerConfigs.keyHint
        });
        await db.insert(shared_db_1.auditLogs).values({
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
        const [updated] = await db.update(shared_db_1.providerConfigs)
            .set({
            encryptedValue,
            keyHint,
            rotatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.id, id), (0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.orgId, session.orgId)))
            .returning({
            id: shared_db_1.providerConfigs.id,
            provider: shared_db_1.providerConfigs.provider,
            keyHint: shared_db_1.providerConfigs.keyHint
        });
        if (!updated) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await db.insert(shared_db_1.auditLogs).values({
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
        const [deleted] = await db.delete(shared_db_1.providerConfigs)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.id, id), (0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.orgId, session.orgId)))
            .returning();
        if (!deleted) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await db.insert(shared_db_1.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'secret.delete',
            resourceType: 'provider_config',
            resourceId: id,
        });
        return reply.status(204).send();
    });
    // FOR SERVICES: Get decrypted key
    fastify.get('/key/:provider', {
        preHandler: [(0, guards_js_1.requirePermission)('secret:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        const { provider } = request.params;
        const [config] = await db.select()
            .from(shared_db_1.providerConfigs)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.orgId, session.orgId), (0, drizzle_orm_1.eq)(shared_db_1.providerConfigs.provider, provider)))
            .limit(1);
        if (!config) {
            return reply.status(404).send({ error: 'CONFIG_NOT_FOUND' });
        }
        const decryptedValue = (0, shared_auth_1.decrypt)(config.encryptedValue, MASTER_KEY);
        return {
            provider: config.provider,
            value: decryptedValue
        };
    });
}
//# sourceMappingURL=providers.js.map