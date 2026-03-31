"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipRoutes = membershipRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
const guards_js_1 = require("../guards.js");
async function membershipRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('user:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        const results = await shared_db_1.db.select({
            id: shared_db_2.memberships.id,
            email: shared_db_2.users.email,
            role: shared_db_2.roles.name,
            status: shared_db_2.memberships.status,
            validUntil: shared_db_2.memberships.validUntil,
        })
            .from(shared_db_2.memberships)
            .innerJoin(shared_db_2.users, (0, shared_db_1.eq)(shared_db_2.memberships.userId, shared_db_2.users.id))
            .innerJoin(shared_db_2.roles, (0, shared_db_1.eq)(shared_db_2.memberships.roleId, shared_db_2.roles.id))
            .where((0, shared_db_1.eq)(shared_db_2.memberships.orgId, session.orgId));
        return results;
    });
    fastify.post('/invite', {
        preHandler: [(0, guards_js_1.requirePermission)('user:invite')]
    }, async (request, reply) => {
        const { email, roleName, validUntil } = request.body;
        const session = request.userSession;
        let [user] = await shared_db_1.db.select().from(shared_db_2.users).where((0, shared_db_1.eq)(shared_db_2.users.email, email)).limit(1);
        if (!user) {
            [user] = await shared_db_1.db.insert(shared_db_2.users).values({
                email,
                passwordHash: 'INVITED_USER_PLACEHOLDER',
                status: 'pending'
            }).returning();
        }
        const [role] = await shared_db_1.db.select().from(shared_db_2.roles)
            .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.roles.name, roleName), (0, shared_db_1.isNull)(shared_db_2.roles.orgId)))
            .limit(1);
        if (!role)
            return reply.status(400).send({ error: 'Role not found' });
        const [membership] = await shared_db_1.db.insert(shared_db_2.memberships).values({
            orgId: session.orgId,
            userId: user.id,
            roleId: role.id,
            status: 'invited',
            invitedBy: session.userId,
            validUntil: validUntil ? new Date(validUntil) : null,
        }).returning();
        await shared_db_1.db.insert(shared_db_2.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'membership.invited',
            payload: JSON.stringify({ email, roleName }),
        });
        return { success: true, membershipId: membership.id };
    });
}
//# sourceMappingURL=memberships.js.map