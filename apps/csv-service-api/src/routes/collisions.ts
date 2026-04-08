import { FastifyInstance } from 'fastify';
import { db, uploadJobs, enrichedItems, collisions, reviewTasks, auditLogs, enrichmentKnowledge, schemaTemplates, schemaFields, eq, and, or, desc, withTenant, count, sql } from '@ecom-kit/shared-db';
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

    // Normalize resolvedValue to a string for consistent storage
    const resolvedValueStr = typeof resolvedValue === 'string' ? resolvedValue : JSON.stringify(resolvedValue);

    // Warn if the field is enum type and resolvedValue is not in allowedValues
    try {
      const template = await db.query.schemaTemplates.findFirst({
        where: and(
          eq(schemaTemplates.jobId, collision.jobId),
          eq(schemaTemplates.orgId, session.orgId)
        ),
        with: { fields: true }
      });
      if (template) {
        const schemaField = template.fields.find((f: any) => f.name === collision.field);
        if (schemaField && schemaField.fieldType === 'enum' && Array.isArray(schemaField.allowedValues) && schemaField.allowedValues.length > 0) {
          if (!schemaField.allowedValues.includes(resolvedValueStr)) {
            console.warn(`[Collision Resolve] resolvedValue "${resolvedValueStr}" is not in allowedValues for enum field "${collision.field}". Allowed: ${schemaField.allowedValues.join(', ')}`);
          }
        }
      }
    } catch (err) {
      console.warn('[Collision Resolve] Failed to validate enum allowedValues:', err);
    }

    await withTenant(session.orgId, async (tx) => {
      // 1. Update collision record
      await tx.update(collisions)
        .set({
          status: 'resolved',
          resolvedValue: resolvedValueStr,
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

      // 3.5 Save to cross-org knowledge base (correction = human fixed AI)
      if (item && collision.originalValue !== resolvedValueStr) {
        // Extract product context from rawData for future matching
        let inputContext = '';
        try {
          const raw = JSON.parse(item.rawData || '{}');
          inputContext = raw.name || raw['Имя [Ru]'] || raw['Название'] || raw.title || '';
          if (!inputContext) inputContext = Object.values(raw).find((v: any) => typeof v === 'string' && v.length > 3 && v.length < 200) as string || '';
        } catch { /* ignore */ }

        if (inputContext) {
          await tx.insert(enrichmentKnowledge).values({
            orgId: session.orgId,
            fieldName: collision.field,
            productCategory: null, // TODO: could be extracted from catalog analysis
            inputContext: String(inputContext).slice(0, 500),
            aiValue: collision.originalValue,
            correctValue: resolvedValueStr,
            source: 'correction',
          });
        }
      }

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

      // Remove the irrelevant field from enrichedData (set to null)
      // This ensures dismissed fields don't appear in the final export
      if (collision.field && collision.field !== '_row_') {
        const item = await tx.query.enrichedItems.findFirst({
          where: eq(enrichedItems.id, collision.enrichedItemId)
        });
        if (item) {
          const enrichedData = JSON.parse(item.enrichedData || '{}');
          delete enrichedData[collision.field];
          await tx.update(enrichedItems)
            .set({ enrichedData: JSON.stringify(enrichedData), updatedAt: new Date() })
            .where(eq(enrichedItems.id, item.id));
        }
      }

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

  // Batch resolve/dismiss collisions
  fastify.post('/uploads/:uploadId/collisions/batch-resolve', async (request, reply) => {
    const session = request.userSession!;
    const { uploadId } = request.params as { uploadId: string };
    const body = request.body as {
      action: 'accept_ai' | 'keep_original' | 'dismiss';
      filter?: { reason?: string; field?: string; minConfidence?: number };
    };

    if (!hasPermission(session, 'collision:resolve')) {
      return reply.status(403).send({ error: 'Forbidden: collision:resolve required' });
    }

    const { action, filter } = body;
    if (!['accept_ai', 'keep_original', 'dismiss'].includes(action)) {
      return reply.status(400).send({ error: 'Invalid action. Must be: accept_ai, keep_original, or dismiss' });
    }

    // Find matching collisions
    const allCollisions = await db.query.collisions.findMany({
      where: and(
        eq(collisions.jobId, uploadId),
        eq(collisions.orgId, session.orgId),
        or(eq(collisions.status, 'detected'), eq(collisions.status, 'pending_review'))
      ),
      with: { item: true }
    });

    // Apply filters
    let filtered = allCollisions;
    if (filter?.reason) {
      filtered = filtered.filter(c => c.reason === filter.reason);
    }
    if (filter?.field) {
      filtered = filtered.filter(c => c.field === filter.field);
    }
    if (filter?.minConfidence !== undefined && filter.minConfidence > 0) {
      filtered = filtered.filter(c => {
        if (!c.item?.confidence) return false;
        return c.item.confidence >= filter.minConfidence!;
      });
    }

    if (filtered.length === 0) {
      return { success: true, resolved: 0, message: 'No matching collisions found' };
    }

    let resolvedCount = 0;

    await withTenant(session.orgId, async (tx) => {
      for (const collision of filtered) {
        if (action === 'dismiss') {
          await tx.update(collisions)
            .set({ status: 'ignored', resolvedBy: session.userId, resolvedAt: new Date() })
            .where(eq(collisions.id, collision.id));
        } else if (action === 'accept_ai') {
          // Accept the AI-suggested value (originalValue = AI's value in collision context)
          await tx.update(collisions)
            .set({ status: 'resolved', resolvedValue: collision.originalValue, resolvedBy: session.userId, resolvedAt: new Date() })
            .where(eq(collisions.id, collision.id));
        } else if (action === 'keep_original') {
          // Keep the original — resolve without changing the enriched data
          await tx.update(collisions)
            .set({ status: 'resolved', resolvedValue: collision.originalValue, resolvedBy: session.userId, resolvedAt: new Date() })
            .where(eq(collisions.id, collision.id));
        }
        resolvedCount++;
      }

      // Check if all collisions for this job are now resolved
      const [remaining] = await tx.select({ value: count() })
        .from(collisions)
        .where(and(
          eq(collisions.jobId, uploadId),
          eq(collisions.orgId, session.orgId),
          or(eq(collisions.status, 'detected'), eq(collisions.status, 'pending_review'))
        ));

      if (remaining.value === 0) {
        await tx.update(reviewTasks)
          .set({ status: 'completed', completedBy: session.userId, completedAt: new Date() })
          .where(and(
            eq(reviewTasks.jobId, uploadId),
            eq(reviewTasks.taskType, 'collision_review'),
            eq(reviewTasks.status, 'pending')
          ));

        await tx.update(uploadJobs)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(and(eq(uploadJobs.id, uploadId), eq(uploadJobs.orgId, session.orgId)));
      }

      // Audit log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'collisions.batch_resolved',
        resourceType: 'upload_job',
        resourceId: uploadId,
        payload: JSON.stringify({ action, filter, resolvedCount }),
      });
    });

    return { success: true, resolved: resolvedCount };
  });

  // Knowledge base stats — most frequently corrected fields
  fastify.get('/knowledge/stats', async (request, reply) => {
    const session = request.userSession!;

    if (!hasPermission(session, 'upload:read')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    // Cross-org: count corrections by field_name
    const stats = await db
      .select({
        fieldName: enrichmentKnowledge.fieldName,
        corrections: count(),
      })
      .from(enrichmentKnowledge)
      .where(eq(enrichmentKnowledge.source, 'correction'))
      .groupBy(enrichmentKnowledge.fieldName)
      .orderBy(desc(count()))
      .limit(15);

    const totalKnowledge = await db
      .select({ value: count() })
      .from(enrichmentKnowledge);

    return {
      topCorrectedFields: stats.map(s => ({ field: s.fieldName, corrections: Number(s.corrections) })),
      totalEntries: Number(totalKnowledge[0]?.value || 0),
    };
  });
}
