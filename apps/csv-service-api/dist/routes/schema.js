"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemaRoutes = schemaRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
async function schemaRoutes(fastify) {
    // Get current schema draft for an upload
    fastify.get('/uploads/:id/schema', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'schema:read')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const template = await shared_db_1.db.query.schemaTemplates.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, id), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.orgId, session.orgId)),
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
        const session = request.userSession;
        const { id } = request.params;
        const { fields } = request.body;
        if (!(0, shared_auth_1.hasPermission)(session, 'schema:update')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        // Input validation: fields must be a non-empty array with required properties
        if (!Array.isArray(fields) || fields.length === 0) {
            return reply.status(400).send({ error: 'INVALID_INPUT', message: '`fields` must be a non-empty array' });
        }
        for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            if (!f || typeof f !== 'object') {
                return reply.status(400).send({ error: 'INVALID_INPUT', message: `fields[${i}] must be an object` });
            }
            if (!f.name || typeof f.name !== 'string') {
                return reply.status(400).send({ error: 'INVALID_INPUT', message: `fields[${i}].name is required and must be a string` });
            }
            if (!f.fieldType || typeof f.fieldType !== 'string') {
                return reply.status(400).send({ error: 'INVALID_INPUT', message: `fields[${i}].fieldType is required and must be a string` });
            }
            if (!f.label || typeof f.label !== 'string') {
                return reply.status(400).send({ error: 'INVALID_INPUT', message: `fields[${i}].label is required and must be a string` });
            }
        }
        const template = await shared_db_1.db.query.schemaTemplates.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, id), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.orgId, session.orgId))
        });
        if (!template || template.status === 'confirmed') {
            return reply.status(400).send({ error: 'SCHEMA_NOT_EDITABLE' });
        }
        const VALID_FIELD_TYPES = ['text', 'number', 'boolean', 'enum', 'url'];
        try {
            await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
                // 1. Delete old fields
                await tx.delete(shared_db_1.schemaFields).where((0, shared_db_1.eq)(shared_db_1.schemaFields.schemaId, template.id));
                // 2. Insert new fields with validation
                for (let i = 0; i < fields.length; i++) {
                    const field = fields[i];
                    // Normalize fieldType — AI or frontend may send invalid values
                    let fieldType = String(field.fieldType || 'text').toLowerCase();
                    if (!VALID_FIELD_TYPES.includes(fieldType)) {
                        // Map common AI-generated aliases to valid types
                        if (['string', 'str', 'varchar'].includes(fieldType))
                            fieldType = 'text';
                        else if (['integer', 'int', 'float', 'decimal', 'double'].includes(fieldType))
                            fieldType = 'number';
                        else if (['bool'].includes(fieldType))
                            fieldType = 'boolean';
                        else if (['select', 'dropdown', 'options', 'choice'].includes(fieldType))
                            fieldType = 'enum';
                        else
                            fieldType = 'text'; // safe fallback
                    }
                    await tx.insert(shared_db_1.schemaFields).values({
                        orgId: session.orgId,
                        schemaId: template.id,
                        name: field.name,
                        label: field.label || field.name,
                        fieldType: fieldType,
                        isRequired: field.isRequired ?? false,
                        allowedValues: Array.isArray(field.allowedValues) ? field.allowedValues.filter(Boolean) : [],
                        description: field.description || null,
                        extractionHint: field.extractionHint || null,
                        sortOrder: i,
                    });
                }
                // 3. Update version + golden samples if provided
                const updateData = { version: template.version + 1 };
                const body = request.body;
                if (body.goldenSamples !== undefined) {
                    updateData.goldenSamples = body.goldenSamples ? JSON.stringify(body.goldenSamples) : null;
                }
                await tx.update(shared_db_1.schemaTemplates)
                    .set(updateData)
                    .where((0, shared_db_1.eq)(shared_db_1.schemaTemplates.id, template.id));
                // 4. Audit Log
                await tx.insert(shared_db_1.auditLogs).values({
                    orgId: session.orgId,
                    userId: session.userId,
                    action: 'schema.update',
                    resourceType: 'schema_template',
                    resourceId: template.id,
                    payload: JSON.stringify({ fieldCount: fields.length }),
                });
            });
            return { success: true };
        }
        catch (err) {
            console.error('[Schema PATCH] Error:', err);
            return reply.status(500).send({ error: err.message || 'Internal error patching schema' });
        }
    });
    // Approve schema
    fastify.post('/uploads/:id/schema/approve', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'schema:approve')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            // 1. Update Schema Status
            await tx.update(shared_db_1.schemaTemplates)
                .set({
                status: 'confirmed',
                confirmedBy: session.userId,
                confirmedAt: new Date()
            })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, id), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.orgId, session.orgId)));
            // 2. Update Job Status
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'schema_confirmed', updatedAt: new Date() })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId)));
            // 3. Complete Review Task
            await tx.update(shared_db_1.reviewTasks)
                .set({
                status: 'completed',
                completedBy: session.userId,
                completedAt: new Date()
            })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, id), (0, shared_db_1.eq)(shared_db_1.reviewTasks.taskType, 'schema_review')));
            // 4. Audit Log
            await tx.insert(shared_db_1.auditLogs).values({
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
        const session = request.userSession;
        const { id } = request.params;
        const { reason } = request.body || {};
        if (!(0, shared_auth_1.hasPermission)(session, 'schema:reject')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        // Verify the upload job exists and belongs to this tenant
        const job = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId))
        });
        if (!job) {
            return reply.status(404).send({ error: 'JOB_NOT_FOUND' });
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            // Strict tenant isolation: filter by BOTH jobId AND orgId
            await tx.update(shared_db_1.schemaTemplates)
                .set({ status: 'rejected' })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, id), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.orgId, session.orgId)));
            // Revert UploadJob back to schema_draft so schema can be regenerated
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'schema_draft', updatedAt: new Date() })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId)));
            // Mark the pending review task as skipped so a new one can be created
            await tx.update(shared_db_1.reviewTasks)
                .set({ status: 'skipped', completedAt: new Date() })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, id), (0, shared_db_1.eq)(shared_db_1.reviewTasks.taskType, 'schema_review'), (0, shared_db_1.eq)(shared_db_1.reviewTasks.status, 'pending')));
            // Audit Log — required for human checkpoint per csv_pipeline.md
            await tx.insert(shared_db_1.auditLogs).values({
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
//# sourceMappingURL=schema.js.map