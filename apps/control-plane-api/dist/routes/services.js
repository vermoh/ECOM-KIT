"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceRoutes = serviceRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const guards_js_1 = require("../guards.js");
async function serviceRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('service:read')]
    }, async (request, reply) => {
        return await shared_db_1.db.select().from(shared_db_2.services);
    });
    fastify.post('/', {
        preHandler: [(0, guards_js_1.requirePermission)('service:register')]
    }, async (request, reply) => {
        const { slug, name, baseUrl, version } = request.body;
        const [newService] = await shared_db_1.db.insert(shared_db_2.services).values({
            slug,
            name,
            baseUrl,
            version,
            status: 'active'
        }).returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
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
        const [grant] = await shared_db_1.db.insert(shared_db_2.serviceAccess).values({
            orgId,
            serviceId,
            validUntil: validUntil ? new Date(validUntil) : null,
            grantedBy: session.userId,
            enabled: true
        }).returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
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
        const [revoked] = await shared_db_1.db.update(shared_db_2.serviceAccess)
            .set({ enabled: false })
            .where((0, shared_db_1.eq)(shared_db_2.serviceAccess.id, id))
            .returning();
        if (!revoked) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
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
        const myAccess = await shared_db_1.db.select({
            serviceId: shared_db_2.serviceAccess.serviceId,
            serviceSlug: shared_db_2.services.slug,
            serviceName: shared_db_2.services.name,
            enabled: shared_db_2.serviceAccess.enabled,
            validUntil: shared_db_2.serviceAccess.validUntil
        })
            .from(shared_db_2.serviceAccess)
            .innerJoin(shared_db_2.services, (0, shared_db_1.eq)(shared_db_2.serviceAccess.serviceId, shared_db_2.services.id))
            .where((0, shared_db_1.eq)(shared_db_2.serviceAccess.orgId, session.orgId));
        return myAccess;
    });
}
//# sourceMappingURL=services.js.map