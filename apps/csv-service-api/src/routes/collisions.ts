import { FastifyInstance } from 'fastify';
import { db, uploadJobs, enrichedItems, collisions, reviewTasks, auditLogs, eq, and, or, withTenant, count } from '@ecom-kit/shared-db';
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

      // 4. Check if all collisions for this job are resolved/dismissed
      // Per state_machines.md: count both 'detected' and 'pending_review' as open
      const [remaining] = await tx.select({ value: count() })
        .from(collisions)
        .where(and(
          eq(collisions.jobId, collision.jobId),
          eq(collisions.orgId, session.orgId),
          or(
            eq(collisions.status, 'detected'),
            eq(collisions.status, 'pending_review')
          )
        ));

      if (remaining.value === 0) {
        // Complete collision review task
        await tx.update(reviewTasks)
          .set({ status: 'completed', completedBy: session.userId, completedAt: new Date() })
          .where(and(
            eq(reviewTasks.jobId, collision.jobId),
            eq(reviewTasks.taskType, 'collision_review'),
            eq(reviewTasks.status, 'pending')
          ));

        await tx.update(uploadJobs)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(and(
            eq(uploadJobs.id, collision.jobId),
            eq(uploadJobs.orgId, session.orgId)
          ));
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
      // Canonical model: dismiss → 'ignored' (not 'dismissed')
      await tx.update(collisions)
        .set({ 
          status: 'ignored',
          resolvedBy: session.userId,
          resolvedAt: new Date()
        })
        .where(and(
          eq(collisions.id, id),
          eq(collisions.orgId, session.orgId)
        ));

      // Audit Log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'collision.dismissed',
        resourceType: 'collision',
        resourceId: collision.id,
        payload: JSON.stringify({ field: collision.field }),
      });

      // Check if all open collisions for this job are resolved/ignored
      // Per state_machines.md: count 'detected' and 'pending_review' as still open
      const [remaining] = await tx.select({ value: count() })
        .from(collisions)
        .where(and(
          eq(collisions.jobId, collision.jobId),
          eq(collisions.orgId, session.orgId),
          or(
            eq(collisions.status, 'detected'),
            eq(collisions.status, 'pending_review')
          )
        ));

      if (remaining.value === 0) {
        // Complete collision review task
        await tx.update(reviewTasks)
          .set({ status: 'completed', completedBy: session.userId, completedAt: new Date() })
          .where(and(
            eq(reviewTasks.jobId, collision.jobId),
            eq(reviewTasks.taskType, 'collision_review'),
            eq(reviewTasks.status, 'pending')
          ));

        await tx.update(uploadJobs)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(and(
            eq(uploadJobs.id, collision.jobId),
            eq(uploadJobs.orgId, session.orgId)
          ));
      }
    });

    return { success: true };
  });
}
