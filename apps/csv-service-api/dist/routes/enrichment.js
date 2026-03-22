"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichmentRoutes = enrichmentRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const queue_1 = require("../lib/queue");
async function enrichmentRoutes(fastify) {
    // Start enrichment process
    fastify.post('/uploads/:id/enrichment/start', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'enrichment:start')) {
            return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
        }
        // 1. Verify job exists and state is SCHEMA_CONFIRMED
        const job = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId)),
            with: {
                schemaTemplates: {
                    where: (0, shared_db_1.eq)(shared_db_1.schemaTemplates.status, 'confirmed'),
                    limit: 1
                }
            }
        });
        if (!job) {
            return reply.status(404).send({ error: 'Upload job not found' });
        }
        if (job.status !== 'schema_confirmed') {
            return reply.status(400).send({ error: `Job status must be schema_confirmed (current: ${job.status})` });
        }
        const confirmedSchema = job.schemaTemplates[0];
        if (!confirmedSchema) {
            return reply.status(400).send({ error: 'No confirmed schema template found for this job' });
        }
        // 2. Create EnrichmentRun
        const [run] = await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            return tx.insert(shared_db_1.enrichmentRuns).values({
                orgId: session.orgId,
                jobId: job.id,
                schemaId: confirmedSchema.id,
                status: 'queued',
                totalItems: job.rowCount || 0,
            }).returning();
        });
        // 3. Queue the job
        await queue_1.enrichmentQueue.add('enrichment', {
            enrichmentRunId: run.id,
            uploadJobId: job.id,
            orgId: session.orgId,
            s3Key: job.s3Key
        });
        // 4. Update UploadJob status
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'enriching', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id));
        });
        return {
            success: true,
            enrichmentRunId: run.id
        };
    });
    // Get enrichment run status
    fastify.get('/enrichment/runs/:runId', async (request, reply) => {
        const session = request.userSession;
        const { runId } = request.params;
        const run = await shared_db_1.db.query.enrichmentRuns.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, runId), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.orgId, session.orgId))
        });
        if (!run) {
            return reply.status(404).send({ error: 'Enrichment run not found' });
        }
        return run;
    });
    // Get SEO task status
    fastify.get('/uploads/:id/seo', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const task = await shared_db_1.db.query.seoTasks.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.seoTasks.uploadId, id), (0, shared_db_1.eq)(shared_db_1.seoTasks.orgId, session.orgId)),
            orderBy: (tasks, { desc }) => [desc(tasks.createdAt)]
        });
        if (!task) {
            return reply.status(404).send({ error: 'SEO task not found for this upload' });
        }
        return task;
    });
}
//# sourceMappingURL=enrichment.js.map