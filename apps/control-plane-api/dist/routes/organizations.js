"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationRoutes = organizationRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const guards_js_1 = require("../guards.js");
async function organizationRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        if (session.roles.includes('super_admin')) {
            const { includeDeleted } = request.query;
            if (includeDeleted === 'true') {
                return shared_db_1.db.select().from(shared_db_2.organizations);
            }
            return shared_db_1.db.select().from(shared_db_2.organizations)
                .where((0, shared_db_1.sql) `${shared_db_2.organizations.status} != 'deleted'`);
        }
        const org = await shared_db_1.db.select().from(shared_db_2.organizations).where((0, shared_db_1.eq)(shared_db_2.organizations.id, session.orgId)).limit(1);
        return org;
    });
    fastify.post('/', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:create')]
    }, async (request, reply) => {
        const { name, slug } = request.body;
        const [newOrg] = await shared_db_1.db.insert(shared_db_2.organizations).values({
            name,
            slug,
            status: 'active',
            plan: 'free',
        }).returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: newOrg.id,
            userId: request.userSession.userId,
            action: 'organization.create',
            payload: JSON.stringify({ name, slug }),
        });
        return newOrg;
    });
    fastify.get('/:id', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:read')]
    }, async (request, reply) => {
        const { id } = request.params;
        const session = request.userSession;
        if (!session.roles.includes('super_admin') && id !== session.orgId) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const [org] = await shared_db_1.db.select().from(shared_db_2.organizations).where((0, shared_db_1.eq)(shared_db_2.organizations.id, id)).limit(1);
        if (!org) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        const [{ memberCount }] = await shared_db_1.db
            .select({ memberCount: (0, shared_db_1.count)() })
            .from(shared_db_2.memberships)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.memberships.orgId, id), (0, shared_db_1.eq)(shared_db_2.memberships.status, 'active')));
        const [tokenBudget] = await shared_db_1.db
            .select()
            .from(shared_db_2.tokenBudgets)
            .where((0, shared_db_1.eq)(shared_db_2.tokenBudgets.orgId, id))
            .limit(1);
        const serviceAccessRows = await shared_db_1.db
            .select({
            id: shared_db_2.serviceAccess.id,
            serviceId: shared_db_2.serviceAccess.serviceId,
            serviceName: shared_db_2.services.name,
            enabled: shared_db_2.serviceAccess.enabled,
            validFrom: shared_db_2.serviceAccess.validFrom,
            validUntil: shared_db_2.serviceAccess.validUntil,
        })
            .from(shared_db_2.serviceAccess)
            .innerJoin(shared_db_2.services, (0, shared_db_1.eq)(shared_db_2.serviceAccess.serviceId, shared_db_2.services.id))
            .where((0, shared_db_1.eq)(shared_db_2.serviceAccess.orgId, id));
        return {
            ...org,
            memberCount: Number(memberCount),
            tokenBudget: tokenBudget ?? null,
            serviceAccess: serviceAccessRows,
        };
    });
    fastify.patch('/:id/status', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:update')]
    }, async (request, reply) => {
        const { id } = request.params;
        const { status } = request.body;
        const session = request.userSession;
        if (!session.roles.includes('super_admin')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const [updatedOrg] = await shared_db_1.db
            .update(shared_db_2.organizations)
            .set({ status, updatedAt: new Date() })
            .where((0, shared_db_1.eq)(shared_db_2.organizations.id, id))
            .returning();
        if (!updatedOrg) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: id,
            userId: session.userId,
            action: 'organization.status_changed',
            resourceType: 'organization',
            resourceId: id,
            payload: JSON.stringify({ status }),
        });
        return updatedOrg;
    });
    fastify.delete('/:id', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:update')]
    }, async (request, reply) => {
        const { id } = request.params;
        const session = request.userSession;
        if (!session.roles.includes('super_admin')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const [deletedOrg] = await shared_db_1.db
            .update(shared_db_2.organizations)
            .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
            .where((0, shared_db_1.eq)(shared_db_2.organizations.id, id))
            .returning();
        if (!deletedOrg) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: id,
            userId: session.userId,
            action: 'organization.deleted',
            resourceType: 'organization',
            resourceId: id,
            payload: JSON.stringify({ deletedAt: deletedOrg.deletedAt }),
        });
        return reply.status(204).send();
    });
    fastify.patch('/:id', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:update')]
    }, async (request, reply) => {
        const { id } = request.params;
        const updates = request.body;
        const session = request.userSession;
        if (!session.roles.includes('super_admin') && session.orgId !== id) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const [updatedOrg] = await shared_db_1.db.update(shared_db_2.organizations)
            .set({ ...updates, updatedAt: new Date() })
            .where((0, shared_db_1.eq)(shared_db_2.organizations.id, id))
            .returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: id,
            userId: session.userId,
            action: 'organization.update',
            payload: JSON.stringify(updates),
        });
        return updatedOrg;
    });
}
//# sourceMappingURL=organizations.js.map