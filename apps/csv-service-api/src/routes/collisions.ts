import { FastifyInstance } from 'fastify';
import { db, uploadJobs, enrichedItems, collisions, auditLogs, eq, and, withTenant, count } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';

export async function collisionsRoutes(fastify: FastifyInstance) {
  
  // List collisions for a job
  fastify.get('/projects/:projectId/jobs/:jobId/collisions', async (request, reply) => {
    const session = request.userSession!;
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };

    if (!hasPermission(session, 'collision:read')) {
      return reply.status(403).send({ error: 'Forbidden: collision:read required' });
    }

    const jobCollisions = await db.query.collisions.findMany({
      where: and(eq(collisions.jobId, jobId), eq(collisions.orgId, session.orgId)),
      with: {
        item: true
      }
    });

    return jobCollisions;
  });

  // Resolve a collision
  fastify.post('/collisions/:id/resolve', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { resolvedValue } = request.body as { resolvedValue: any };

    if (!hasPermission(session, 'collision:resolve')) {
      return reply.status(403).send({ error: 'Forbidden: collision:resolve required' });
    }

    const collision = await db.query.collisions.findFirst({
      where: and(eq(collisions.id, id), eq(collisions.orgId, session.orgId))
    });

    if (!collision) {
      return reply.status(404).send({ error: 'Collision not found' });
    }

    await withTenant(session.orgId, async (tx) => {
      // 1. Update collision record
      await tx.update(collisions)
        .set({ 
          status: 'resolved', 
          resolvedValue: JSON.stringify(resolvedValue),
          resolvedBy: session.userId,
          resolvedAt: new Date()
        })
        .where(eq(collisions.id, id));

      // 2. Update enriched item data
      const item = await tx.query.enrichedItems.findFirst({
        where: eq(enrichedItems.id, collision.enrichedItemId)
      });

      if (item) {
        const enrichedData = JSON.parse(item.enrichedData || '{}');
        enrichedData[collision.field] = resolvedValue;
        
        await tx.update(enrichedItems)
          .set({ 
            enrichedData: JSON.stringify(enrichedData),
            status: 'manual_override',
            reviewedBy: session.userId,
            reviewedAt: new Date()
          })
          .where(eq(enrichedItems.id, item.id));
      }

      // 3. Audit Log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'collision_resolved',
        resourceType: 'collision',
        resourceId: collision.id,
        payload: JSON.stringify({ field: collision.field, resolvedValue }),
      });

      // 4. Check if all collisions for this job are resolved
      const [remaining] = await tx.select({ value: count() })
        .from(collisions)
        .where(and(
          eq(collisions.jobId, collision.jobId), 
          eq(collisions.status, 'detected')
        ));

      if (remaining.value === 0) {
        await tx.update(uploadJobs)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(eq(uploadJobs.id, collision.jobId));
      }
    });

    return { success: true };
  });

  // Dismiss a collision
  fastify.post('/collisions/:id/dismiss', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'collision:resolve')) {
      return reply.status(403).send({ error: 'Forbidden: collision:resolve required' });
    }

    const collision = await db.query.collisions.findFirst({
      where: and(eq(collisions.id, id), eq(collisions.orgId, session.orgId))
    });

    if (!collision) {
      return reply.status(404).send({ error: 'Collision not found' });
    }

    await withTenant(session.orgId, async (tx) => {
      await tx.update(collisions)
        .set({ 
          status: 'dismissed',
          resolvedBy: session.userId,
          resolvedAt: new Date()
        })
        .where(eq(collisions.id, id));

      // Audit Log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'collision_dismissed',
        resourceType: 'collision',
        resourceId: collision.id,
        payload: JSON.stringify({ field: collision.field }),
      });

      // Check if all collisions for this job are resolved/dismissed
      const [remaining] = await tx.select({ value: count() })
        .from(collisions)
        .where(and(
          eq(collisions.jobId, collision.jobId), 
          eq(collisions.status, 'detected')
        ));

      if (remaining.value === 0) {
        await tx.update(uploadJobs)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(eq(uploadJobs.id, collision.jobId));
      }
    });

    return { success: true };
  });
}
