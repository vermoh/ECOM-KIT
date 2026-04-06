import { FastifyInstance } from 'fastify';
import { eq, and, or, count, sql, db } from '@ecom-kit/shared-db';
import { organizations, auditLogs, memberships, tokenBudgets, serviceAccess, services } from '@ecom-kit/shared-db';
import { requirePermission } from '../guards.js';

export async function organizationRoutes(fastify: FastifyInstance) {
  // Layer 4 & 5: Permissions & Tenant Isolation
  
  fastify.get('/', {
    preHandler: [requirePermission('organization:read')]
  }, async (request, reply) => {
    // If super_admin, can read all, else only own (though RLS would handle this too)
    const session = request.userSession!;
    
    if (session.roles.includes('super_admin')) {
      const { includeDeleted } = request.query as any;
      if (includeDeleted === 'true') {
        return db.select().from(organizations);
      }
      return db.select().from(organizations)
        .where(sql`${organizations.status} != 'deleted'`);
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

  // GET /:id — Get single organization detail
  fastify.get('/:id', {
    preHandler: [requirePermission('organization:read')]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const session = request.userSession!;

    // Only super_admin can read any org; others can only read their own
    if (!session.roles.includes('super_admin') && id !== session.orgId) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);

    if (!org) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    const [{ memberCount }] = await db
      .select({ memberCount: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, id), eq(memberships.status, 'active')));

    const [tokenBudget] = await db
      .select()
      .from(tokenBudgets)
      .where(eq(tokenBudgets.orgId, id))
      .limit(1);

    const serviceAccessRows = await db
      .select({
        id: serviceAccess.id,
        serviceId: serviceAccess.serviceId,
        serviceName: services.name,
        enabled: serviceAccess.enabled,
        validFrom: serviceAccess.validFrom,
        validUntil: serviceAccess.validUntil,
      })
      .from(serviceAccess)
      .innerJoin(services, eq(serviceAccess.serviceId, services.id))
      .where(eq(serviceAccess.orgId, id));

    return {
      ...org,
      memberCount: Number(memberCount),
      tokenBudget: tokenBudget ?? null,
      serviceAccess: serviceAccessRows,
    };
  });

  // PATCH /:id/status — Change org status (super_admin only)
  fastify.patch('/:id/status', {
    preHandler: [requirePermission('organization:update')]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as { status: 'active' | 'suspended' | 'deleted' };
    const session = request.userSession!;

    if (!session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const [updatedOrg] = await db
      .update(organizations)
      .set({ status, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();

    if (!updatedOrg) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    await db.insert(auditLogs).values({
      orgId: id,
      userId: session.userId,
      action: 'organization.status_changed',
      resourceType: 'organization',
      resourceId: id,
      payload: JSON.stringify({ status }),
    });

    return updatedOrg;
  });

  // DELETE /:id — Soft delete org (super_admin only)
  fastify.delete('/:id', {
    preHandler: [requirePermission('organization:update')]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const session = request.userSession!;

    if (!session.roles.includes('super_admin')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const [deletedOrg] = await db
      .update(organizations)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();

    if (!deletedOrg) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    await db.insert(auditLogs).values({
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
