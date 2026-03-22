"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationRoutes = organizationRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const guards_js_1 = require("../guards.js");
const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = (0, postgres_1.default)(connectionString);
const db = (0, postgres_js_1.drizzle)(client);
async function organizationRoutes(fastify) {
    // Layer 4 & 5: Permissions & Tenant Isolation
    fastify.get('/', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:read')]
    }, async (request, reply) => {
        // If super_admin, can read all, else only own (though RLS would handle this too)
        const session = request.userSession;
        if (session.roles.includes('super_admin')) {
            const allOrgs = await db.select().from(shared_db_1.organizations);
            return allOrgs;
        }
        const org = await db.select().from(shared_db_1.organizations).where((0, drizzle_orm_1.eq)(shared_db_1.organizations.id, session.orgId)).limit(1);
        return org;
    });
    fastify.post('/', {
        preHandler: [(0, guards_js_1.requirePermission)('organization:create')]
    }, async (request, reply) => {
        const { name, slug } = request.body;
        const [newOrg] = await db.insert(shared_db_1.organizations).values({
            name,
            slug,
            status: 'active',
            plan: 'free',
        }).returning();
        await db.insert(shared_db_1.auditLogs).values({
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
        // Security: Only super_admin or owner of THIS org can update
        if (!session.roles.includes('super_admin') && session.orgId !== id) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const [updatedOrg] = await db.update(shared_db_1.organizations)
            .set({ ...updates, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(shared_db_1.organizations.id, id))
            .returning();
        await db.insert(shared_db_1.auditLogs).values({
            orgId: id,
            userId: session.userId,
            action: 'organization.update',
            payload: JSON.stringify(updates),
        });
        return updatedOrg;
    });
}
//# sourceMappingURL=organizations.js.map