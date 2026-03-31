"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadRoutes = uploadRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const s3_1 = require("../lib/s3");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const uuid_1 = require("uuid");
const queue_1 = require("../lib/queue");
async function uploadRoutes(fastify) {
    // Request a pre-signed URL for CSV upload
    fastify.post('/projects/:projectId/uploads', async (request, reply) => {
        const session = request.userSession;
        const { projectId } = request.params;
        const { filename, includeSeo, catalogContext } = request.body;
        if (!(0, shared_auth_1.hasPermission)(session, 'upload:create')) {
            return reply.status(403).send({ error: 'Forbidden: upload:create required' });
        }
        if (!filename) {
            return reply.status(400).send({ error: 'Filename is required' });
        }
        // Verify project exists and belongs to org
        const project = await shared_db_1.db.query.projects.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.projects.id, projectId), (0, shared_db_1.eq)(shared_db_1.projects.orgId, session.orgId))
        });
        if (!project) {
            return reply.status(404).send({ error: 'Project not found' });
        }
        const uploadJobId = (0, uuid_1.v4)();
        const s3Key = `${session.orgId}/${projectId}/${uploadJobId}/${filename}`;
        // Create UploadJob in PENDING status
        const [job] = await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            return tx.insert(shared_db_1.uploadJobs).values({
                id: uploadJobId,
                orgId: session.orgId,
                projectId,
                status: 'pending',
                s3Key,
                originalFilename: filename,
                includeSeo: includeSeo || false,
                catalogContext: catalogContext || null,
            }).returning();
        });
        // Generate Pre-signed URL
        const command = new client_s3_1.PutObjectCommand({
            Bucket: s3_1.BUCKET_NAME,
            Key: s3Key,
            ContentType: 'text/csv',
        });
        const presignedUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3_1.s3Client, command, { expiresIn: 3600 });
        return {
            uploadJobId: job.id,
            presignedUrl,
            s3Key
        };
    });
    // Get upload job status
    fastify.get('/uploads/:id', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'upload:read')) {
            return reply.status(403).send({ error: 'Forbidden: upload:read required' });
        }
        const job = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId))
        });
        if (!job) {
            return reply.status(404).send({ error: 'Upload job not found' });
        }
        const latestRun = await shared_db_1.db.query.enrichmentRuns.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.jobId, job.id), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.orgId, session.orgId)),
            orderBy: (runs, { desc }) => [desc(runs.createdAt)],
        });
        return {
            ...job,
            enrichmentRun: latestRun || null
        };
    });
    // List uploads for a project
    fastify.get('/projects/:projectId/uploads', async (request, reply) => {
        const session = request.userSession;
        const { projectId } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'upload:read')) {
            return reply.status(403).send({ error: 'Forbidden: upload:read required' });
        }
        const jobs = await shared_db_1.db.query.uploadJobs.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.projectId, projectId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId)),
            orderBy: (jobs, { desc }) => [desc(jobs.createdAt)]
        });
        return jobs;
    });
    // Start processing an upload
    fastify.post('/uploads/:id/start', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const { includeSeo } = request.body;
        if (!(0, shared_auth_1.hasPermission)(session, 'enrichment:start')) {
            return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
        }
        const job = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId))
        });
        if (!job) {
            return reply.status(404).send({ error: 'Upload job not found' });
        }
        if (job.status !== 'pending' && job.status !== 'failed') {
            return reply.status(400).send({ error: 'Job already in progress or completed' });
        }
        // Extract bearer token from header to pass as access grant
        const authHeader = request.headers.authorization;
        const accessGrantToken = authHeader?.replace('Bearer ', '');
        // Add to parsing queue
        await queue_1.csvParsingQueue.add('csv-parsing', {
            uploadJobId: job.id,
            orgId: session.orgId,
            s3Key: job.s3Key,
            accessGrantToken
        });
        // Update status to pending (redundant but sets updatedAt)
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            const updateData = { status: 'pending', updatedAt: new Date() };
            if (includeSeo !== undefined) {
                updateData.includeSeo = includeSeo;
            }
            await tx.update(shared_db_1.uploadJobs)
                .set(updateData)
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id));
        });
        return { success: true };
    });
}
//# sourceMappingURL=uploads.js.map