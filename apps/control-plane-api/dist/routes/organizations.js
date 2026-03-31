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
            const allOrgs = await shared_db_1.db.select().from(shared_db_2.organizations);
            return allOrgs;
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