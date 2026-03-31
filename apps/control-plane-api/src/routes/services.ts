import { FastifyInstance } from 'fastify';
import { eq, and, db } from '@ecom-kit/shared-db';
import { services, serviceAccess, auditLogs } from '@ecom-kit/shared-db';
import { requirePermission } from '../guards.js';

export async function serviceRoutes(fastify: FastifyInstance) {
  
  // List all services
  fastify.get('/', {
    preHandler: [requirePermission('service:read')]
  }, async (request, reply) => {
    return await db.select().from(services);
  });

  // Register a new service (super_admin only implied by permission)
  fastify.post('/', {
    preHandler: [requirePermission('service:register')]
  }, async (request, reply) => {
    const { slug, name, baseUrl, version } = request.body as any;
    
    const [newService] = await db.insert(services).values({
      slug,
      name,
      baseUrl,
      version,
      status: 'active'
    }).returning();

    await db.insert(auditLogs).values({
      userId: request.userSession!.userId,
      action: 'service.register',
      resourceType: 'service',
      resourceId: newService.id,
      payload: JSON.stringify({ slug, name }),
    });

    return newService;
  });

  // Grant access to a service for an organization
  fastify.post('/grant', {
    preHandler: [requirePermission('service:grant_access')]
  }, async (request, reply) => {
    const { orgId, serviceId, validUntil } = request.body as any;
    const session = request.userSession!;

    const [grant] = await db.insert(serviceAccess).values({
      orgId,
      serviceId,
      validUntil: validUntil ? new Date(validUntil) : null,
      grantedBy: session.userId,
      enabled: true
    }).returning();

    await db.insert(auditLogs).values({
      orgId,
      userId: session.userId,
      action: 'service.grant_access',
      resourceType: 'service_access',
      resourceId: grant.id,
      payload: JSON.stringify({ orgId, serviceId }),
    });

    return grant;
  });

  // Revoke access
  fastify.post('/revoke/:id', {
    preHandler: [requirePermission('service:revoke_access')]
  }, async (request, reply) => {
    const { id } = request.params as any;
    const session = request.userSession!;

    const [revoked] = await db.update(serviceAccess)
      .set({ enabled: false })
      .where(eq(serviceAccess.id, id))
      .returning();

    if (!revoked) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    await db.insert(auditLogs).values({
      orgId: revoked.orgId,
      userId: session.userId,
      action: 'service.revoke_access',
      resourceType: 'service_access',
      resourceId: id,
    });

    return revoked;
  });

  // Get service access for current org
  fastify.get('/my-access', {
    preHandler: [requirePermission('service:read')]
  }, async (request, reply) => {
    const session = request.userSession!;
    
    const myAccess = await db.select({
      serviceId: serviceAccess.serviceId,
      serviceSlug: services.slug,
      serviceName: services.name,
      enabled: serviceAccess.enabled,
      validUntil: serviceAccess.validUntil
    })
    .from(serviceAccess)
    .innerJoin(services, eq(serviceAccess.serviceId, services.id))
    .where(eq(serviceAccess.orgId, session.orgId));
    
    return myAccess;
  });
}
