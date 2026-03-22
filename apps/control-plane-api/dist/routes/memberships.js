"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipRoutes = membershipRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const guards_js_1 = require("../guards.js");
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = (0, postgres_1.default)(connectionString);
const db = (0, postgres_js_1.drizzle)(client);
async function membershipRoutes(fastify) {
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('user:read')]
    }, async (request, reply) => {
        const session = request.userSession;
        const results = await db.select({
            id: shared_db_1.memberships.id,
            email: shared_db_1.users.email,
            role: shared_db_1.roles.name,
            status: shared_db_1.memberships.status,
            validUntil: shared_db_1.memberships.validUntil,
        })
            .from(shared_db_1.memberships)
            .innerJoin(shared_db_1.users, (0, drizzle_orm_1.eq)(shared_db_1.memberships.userId, shared_db_1.users.id))
            .innerJoin(shared_db_1.roles, (0, drizzle_orm_1.eq)(shared_db_1.memberships.roleId, shared_db_1.roles.id))
            .where((0, drizzle_orm_1.eq)(shared_db_1.memberships.orgId, session.orgId));
        return results;
    });
    fastify.post('/invite', {
        preHandler: [(0, guards_js_1.requirePermission)('user:invite')]
    }, async (request, reply) => {
        const { email, roleName, validUntil } = request.body;
        const session = request.userSession;
        let [user] = await db.select().from(shared_db_1.users).where((0, drizzle_orm_1.eq)(shared_db_1.users.email, email)).limit(1);
        if (!user) {
            [user] = await db.insert(shared_db_1.users).values({
                email,
                passwordHash: 'INVITED_USER_PLACEHOLDER',
                status: 'pending'
            }).returning();
        }
        const [role] = await db.select().from(shared_db_1.roles)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.roles.name, roleName), (0, drizzle_orm_1.isNull)(shared_db_1.roles.orgId)))
            .limit(1);
        if (!role)
            return reply.status(400).send({ error: 'Role not found' });
        const [membership] = await db.insert(shared_db_1.memberships).values({
            orgId: session.orgId,
            userId: user.id,
            roleId: role.id,
            status: 'invited',
            invitedBy: session.userId,
            validUntil: validUntil ? new Date(validUntil) : null,
        }).returning();
        await db.insert(shared_db_1.auditLogs).values({
            orgId: session.orgId,
            userId: session.userId,
            action: 'membership.invited',
            payload: JSON.stringify({ email, roleName }),
        });
        return { success: true, membershipId: membership.id };
    });
}
//# sourceMappingURL=memberships.js.map