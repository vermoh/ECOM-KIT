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

    if (!hasPermission(session, 'schema:reject')) {
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    await withTenant(session.orgId, async (tx) => {
      await tx.update(schemaTemplates)
        .set({ status: 'rejected' })
        .where(eq(schemaTemplates.jobId, id));

      await tx.update(uploadJobs)
        .set({ status: 'schema_draft' })
        .where(eq(uploadJobs.id, id));
      
      // Audit Log
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'schema.reject',
        resourceType: 'upload_job',
        resourceId: id,
      });
    });

    return { success: true };
  });
}
