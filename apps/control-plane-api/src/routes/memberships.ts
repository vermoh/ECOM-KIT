import { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { users, memberships, roles, auditLogs } from '@ecom-kit/shared-db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requirePermission } from '../guards.js';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

export async function membershipRoutes(fastify: FastifyInstance) {
  
  fastify.get('/', {
    preHandler: [requirePermission('user:read')]
  }, async (request, reply) => {
    const session = request.userSession!;
    
    const results = await db.select({
      id: memberships.id,
      email: users.email,
      role: roles.name,
      status: memberships.status,
      validUntil: memberships.validUntil,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.orgId, session.orgId));

    return results;
  });

  fastify.post('/invite', {
    preHandler: [requirePermission('user:invite')]
  }, async (request, reply) => {
    const { email, roleName, validUntil } = request.body as any;
    const session = request.userSession!;

    // 1. Find or create user (placeholder for actual invite flow)
    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
       [user] = await db.insert(users).values({
         email,
         passwordHash: 'INVITED_USER_PLACEHOLDER', // In real app, person sets password after clicking link
         status: 'pending'
       }).returning();
    }

    // 2. Find role
    const [role] = await db.select().from(roles)
      .where(and(eq(roles.name, roleName), isNull(roles.orgId))) // system roles
      .limit(1);

    if (!role) return reply.status(400).send({ error: 'Role not found' });

    // 3. Create membership
    const [membership] = await db.insert(memberships).values({
      orgId: session.orgId,
      userId: user.id,
      roleId: role.id,
      status: 'invited',
      invitedBy: session.userId,
      validUntil: validUntil ? new Date(validUntil) : null,
    }).returning();

    await db.insert(auditLogs).values({
      orgId: session.orgId,
      userId: session.userId,
      action: 'membership.invited',
      payload: JSON.stringify({ email, roleName }),
    });

    return { success: true, membershipId: membership.id };
  });
}
