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
        const template = await shared_db_1.db.query.schemaTemplates.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, id), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.orgId, session.orgId))
        });
        if (!template || template.status === 'confirmed') {
            return reply.status(400).send({ error: 'SCHEMA_NOT_EDITABLE' });
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            // 1. Delete old fields
            await tx.delete(shared_db_1.schemaFields).where((0, shared_db_1.eq)(shared_db_1.schemaFields.schemaId, template.id));
            // 2. Insert new fields
            for (let i = 0; i < fields.length; i++) {
                const field = fields[i];
                await tx.insert(shared_db_1.schemaFields).values({
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
            await tx.update(shared_db_1.schemaTemplates)
                .set({ version: template.version + 1 })
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
        if (!(0, shared_auth_1.hasPermission)(session, 'schema:reject')) {
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            await tx.update(shared_db_1.schemaTemplates)
                .set({ status: 'rejected' })
                .where((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, id));
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'schema_draft' })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id));
            // Audit Log
            await tx.insert(shared_db_1.auditLogs).values({
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
//# sourceMappingURL=schema.js.map