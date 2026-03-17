import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { organizations, auditLogs } from '@ecom-kit/shared-db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requirePermission } from '../guards.js';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

export async function organizationRoutes(fastify: FastifyInstance) {
  // Layer 4 & 5: Permissions & Tenant Isolation
  
  fastify.get('/', {
    preHandler: [requirePermission('organization:read')]
  }, async (request, reply) => {
    // If super_admin, can read all, else only own (though RLS would handle this too)
    const session = request.userSession!;
    
    if (session.roles.includes('super_admin')) {
      const allOrgs = await db.select().from(organizations);
      return allOrgs;
    }

    const org = await db.select().from(organizations).where(eq(organizations.id, session.orgId)).limit(1);
    return org;
  });

  fastify.post('/', {
    preHandler: [requirePermission('organization:create')]
  }, async (request, reply) => {
    const { name, slug } = request.body as any;
    
    const [newOrg] = await db.insert(organizations).values({
      name,
      slug,
      status: 'active',
      plan: 'free',
    }).returning();

    await db.insert(auditLogs).values({
      orgId: newOrg.id,
      userId: request.userSession!.userId,
      action: 'organization.create',
      payload: JSON.stringify({ name, slug }),
    });

    return newOrg;
  });

  fastify.patch('/:id', {
    preHandler: [requirePermission('organization:update')]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const updates = request.body as any;
    const session = request.userSession!;

    // Security: Only super_admin or owner of THIS org can update
    if (!session.roles.includes('super_admin') && session.orgId !== id) {
       return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const [updatedOrg] = await db.update(organizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();

    await db.insert(auditLogs).values({
      orgId: id,
      userId: session.userId,
      action: 'organization.update',
      payload: JSON.stringify(updates),
    });

    return updatedOrg;
  });
}
