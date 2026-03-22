"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceRoutes = serviceRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const guards_js_1 = require("../guards.js");
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = (0, postgres_1.default)(connectionString);
const db = (0, postgres_js_1.drizzle)(client);
async function serviceRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('service:read')]
    }, async (request, reply) => {
        return await db.select().from(shared_db_1.services);
    });
    fastify.post('/', {
        preHandler: [(0, guards_js_1.requirePermission)('service:register')]
    }, async (request, reply) => {
        const { slug, name, baseUrl, version } = request.body;
        const [newService] = await db.insert(shared_db_1.services).values({
            slug,
            name,
            baseUrl,
            version,
            status: 'active'
        }).returning();
        await db.insert(shared_db_1.auditLogs).values({
            userId: request.userSession.userId,
            action: 'service.register',
            resourceType: 'service',
            resourceId: newService.id,
            payload: JSON.stringify({ slug, name }),
        });
        return newService;
    });
    fastify.post('/grant', {
        preHandler: [(0, guards_js_1.requirePermission)('service:grant_access')]
    }, async (request, reply) => {
        const { orgId, serviceId, validUntil } = request.body;
        const session = request.userSession;
        const [grant] = await db.insert(shared_db_1.serviceAccess).values({
            orgId,
            serviceId,
            validUntil: validUntil ? new Date(validUntil) : null,
            grantedBy: session.userId,
            enabled: true
        }).returning();
        await db.insert(shared_db_1.auditLogs).values({
            orgId,
            userId: session.userId,
            action: 'service.grant_access',
            resourceType: 'service_access',
            resourceId: grant.id,
            payload: JSON.stringify({ orgId, serviceId }),
        });
        return grant;
    });
    fastify.post('/revoke/:id', {
        preHandler: [(0, guards_js_1.requirePermission)('service:revoke_access')]
    }, async (request, reply) => {
        const { id } = request.params;
        const session = request.userSession;
        const [revoked] = await db.update(shared_db_1.serviceAccess)
            .set({ enabled: false })
            .where((0, drizzle_orm_1.eq)(shared_db_1.serviceAccess.id, id))
            .returning();
        if (!revoked) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await db.insert(shared_db_1.auditLogs).values({
            orgId: revoked.orgId,
            userId: session.userId,
            action: 'service.revoke_access',
            resourceType: 'service_access',
            resourceId: id,
        });
        return revoked;
    });
    fastify.get('/my-access', {
        preHandler: [(0, guards_js_1.requirePermission)('service:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        const myAccess = await db.select({
            serviceId: shared_db_1.serviceAccess.serviceId,
            serviceSlug: shared_db_1.services.slug,
            serviceName: shared_db_1.services.name,
            enabled: shared_db_1.serviceAccess.enabled,
            validUntil: shared_db_1.serviceAccess.validUntil
        })
            .from(shared_db_1.serviceAccess)
            .innerJoin(shared_db_1.services, (0, drizzle_orm_1.eq)(shared_db_1.serviceAccess.serviceId, shared_db_1.services.id))
            .where((0, drizzle_orm_1.eq)(shared_db_1.serviceAccess.orgId, session.orgId));
        return myAccess;
    });
}
//# sourceMappingURL=services.js.map