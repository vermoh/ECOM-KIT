import { FastifyInstance } from 'fastify';
import { db, schemaTemplates, schemaFields, uploadJobs, reviewTasks, auditLogs, eq, and, withTenant } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';

export async function schemaRoutes(fastify: FastifyInstance) {
  
  // Get current schema draft for an upload
  fastify.get('/uploads/:id/schema', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'schema:read')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const template = await db.query.schemaTemplates.findFirst({
      where: and(
        eq(schemaTemplates.jobId, id),
        eq(schemaTemplates.orgId, session.orgId)
      ),
      with: {
        fields: true
      }
    });

    if (!template) {
      return reply.status(404).send({ error: 'SCHEMA_NOT_FOUND' });
    }

    return template;
  });

  // Update schema fields
  fastify.patch('/uploads/:id/schema', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { fields } = request.body as { fields: any[] };

    if (!hasPermission(session, 'schema:update')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const template = await db.query.schemaTemplates.findFirst({
      where: and(
        eq(schemaTemplates.jobId, id),
        eq(schemaTemplates.orgId, session.orgId)
      )
    });

    if (!template || template.status === 'confirmed') {
      return reply.status(400).send({ error: 'SCHEMA_NOT_EDITABLE' });
    }

    await withTenant(session.orgId, async (tx) => {
      // 1. Delete old fields
      await tx.delete(schemaFields).where(eq(schemaFields.schemaId, template.id));

      // 2. Insert new fields
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        await tx.insert(schemaFields).values({
          orgId: session.orgId,
          schemaId: template.id,
          name: field.name,
          label: field.label,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          allowedValues: field.allowedValues,
          description: field.description,
          sortOrder: i,
        });
      }

      // 3. Update version
      await tx.update(schemaTemplates)
        .set({ version: template.version + 1 })
        .where(eq(schemaTemplates.id, template.id));

      // 4. Audit Log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'schema.update',
        resourceType: 'schema_template',
        resourceId: template.id,
        payload: JSON.stringify({ fieldCount: fields.length }),
      });
    });

    return { success: true };
  });

  // Approve schema
  fastify.post('/uploads/:id/schema/approve', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'schema:approve')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    await withTenant(session.orgId, async (tx) => {
      // 1. Update Schema Status
      await tx.update(schemaTemplates)
        .set({ 
          status: 'confirmed', 
          confirmedBy: session.userId, 
          confirmedAt: new Date() 
        })
        .where(and(
          eq(schemaTemplates.jobId, id),
          eq(schemaTemplates.orgId, session.orgId)
        ));

      // 2. Update Job Status
      await tx.update(uploadJobs)
        .set({ status: 'schema_confirmed', updatedAt: new Date() })
        .where(and(
          eq(uploadJobs.id, id),
          eq(uploadJobs.orgId, session.orgId)
        ));

      // 3. Complete Review Task
      await tx.update(reviewTasks)
        .set({ 
          status: 'completed', 
          completedBy: session.userId, 
          completedAt: new Date() 
        })
        .where(and(
          eq(reviewTasks.jobId, id),
          eq(reviewTasks.taskType, 'schema_review')
        ));
      
      // 4. Audit Log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'schema.approve',
        resourceType: 'upload_job',
        resourceId: id,
      });
    });

    return { success: true };
  });

  // Reject schema
  fastify.post('/uploads/:id/schema/reject', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { reason } = (request.body as { reason?: string }) || {};

    if (!hasPermission(session, 'schema:reject')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    // Verify the upload job exists and belongs to this tenant
    const job = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, id), eq(uploadJobs.orgId, session.orgId))
    });

    if (!job) {
      return reply.status(404).send({ error: 'JOB_NOT_FOUND' });
    }

    await withTenant(session.orgId, async (tx) => {
      // Strict tenant isolation: filter by BOTH jobId AND orgId
      await tx.update(schemaTemplates)
        .set({ status: 'rejected' })
        .where(and(
          eq(schemaTemplates.jobId, id),
          eq(schemaTemplates.orgId, session.orgId)
        ));

      // Revert UploadJob back to schema_draft so schema can be regenerated
      await tx.update(uploadJobs)
        .set({ status: 'schema_draft', updatedAt: new Date() })
        .where(and(
          eq(uploadJobs.id, id),
          eq(uploadJobs.orgId, session.orgId)
        ));

      // Mark the pending review task as skipped so a new one can be created
      await tx.update(reviewTasks)
        .set({ status: 'skipped', completedAt: new Date() })
        .where(and(
          eq(reviewTasks.jobId, id),
          eq(reviewTasks.taskType, 'schema_review'),
          eq(reviewTasks.status, 'pending')
        ));
      
      // Audit Log — required for human checkpoint per csv_pipeline.md
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'schema.reject',
        resourceType: 'upload_job',
        resourceId: id,
        payload: JSON.stringify({ reason: reason || null }),
      });
    });

    return { success: true };
  });
}
