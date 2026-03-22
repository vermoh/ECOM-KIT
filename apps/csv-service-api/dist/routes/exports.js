"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportRoutes = exportRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const queue_1 = require("../lib/queue");
const uuid_1 = require("uuid");
async function exportRoutes(fastify) {
    // Trigger a new export
    fastify.post('/projects/:projectId/uploads/:uploadId/export', async (request, reply) => {
        const session = request.userSession;
        const { projectId, uploadId } = request.params;
        const { includeSeo = false } = request.body || {};
        if (!(0, shared_auth_1.hasPermission)(session, 'export:create')) {
            return reply.status(403).send({ error: 'Forbidden: export:create required' });
        }
        // Verify project and upload exist and belong to org
        const upload = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.projectId, projectId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId))
        });
        if (!upload) {
            return reply.status(404).send({ error: 'Upload not found' });
        }
        if (upload.status !== 'ready' && upload.status !== 'done') {
            return reply.status(400).send({ error: 'Upload is not ready for export. Current status: ' + upload.status });
        }
        const exportJobId = (0, uuid_1.v4)();
        // Create ExportJob
        const [job] = await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            // Update upload status to exporting
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'exporting', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId));
            return tx.insert(shared_db_1.exportJobs).values({
                id: exportJobId,
                orgId: session.orgId,
                uploadId,
                requestedBy: session.userId,
                status: 'queued',
                includeSeo,
            }).returning();
        });
        // Audit Log
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            await tx.insert(shared_db_1.auditLogs).values({
                orgId: session.orgId,
                userId: session.userId,
                action: 'export.started',
                resourceType: 'upload_job',
                resourceId: uploadId,
                payload: JSON.stringify({ exportJobId, includeSeo }),
            });
        });
        // Add to export queue
        await queue_1.exportQueue.add('export', {
            exportJobId: job.id,
            uploadId,
            orgId: session.orgId,
            includeSeo,
        });
        return {
            exportJobId: job.id,
            status: job.status
        };
    });
    // Get export job status
    fastify.get('/projects/:projectId/uploads/:uploadId/exports/:id', async (request, reply) => {
        const session = request.userSession;
        const { id, uploadId } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'export:read')) {
            return reply.status(403).send({ error: 'Forbidden: export:read required' });
        }
        const job = await shared_db_1.db.query.exportJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.exportJobs.id, id), (0, shared_db_1.eq)(shared_db_1.exportJobs.uploadId, uploadId), (0, shared_db_1.eq)(shared_db_1.exportJobs.orgId, session.orgId))
        });
        if (!job) {
            return reply.status(404).send({ error: 'Export job not found' });
        }
        return job;
    });
    // List exports for an upload
    fastify.get('/projects/:projectId/uploads/:uploadId/exports', async (request, reply) => {
        const session = request.userSession;
        const { uploadId } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'export:read')) {
            return reply.status(403).send({ error: 'Forbidden: export:read required' });
        }
        const jobs = await shared_db_1.db.query.exportJobs.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.exportJobs.uploadId, uploadId), (0, shared_db_1.eq)(shared_db_1.exportJobs.orgId, session.orgId)),
            orderBy: (jobs, { desc }) => [desc(jobs.createdAt)]
        });
        return jobs;
    });
}
//# sourceMappingURL=exports.js.map