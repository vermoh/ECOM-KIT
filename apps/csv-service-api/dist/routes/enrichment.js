"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichmentRoutes = enrichmentRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
const queue_1 = require("../lib/queue");
const ioredis_1 = __importDefault(require("ioredis"));
const bullmq_1 = require("bullmq");
const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4000';
const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';
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
        // 2.5 Issue AccessGrant for the worker
        let accessGrantToken;
        try {
            const grantRes = await fetch(`${CP_URL}/api/v1/grants/issue-internal`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SERVICE_TOKEN}`
                },
                body: JSON.stringify({
                    serviceSlug: 'csv-service-worker',
                    scopes: ['secret:read', 'enrichment:write'],
                    orgId: session.orgId
                })
            });
            if (grantRes.ok) {
                const grantData = await grantRes.json();
                accessGrantToken = grantData.token;
                console.log('[Enrichment] AccessGrant issued successfully');
            }
            else {
                const errBody = await grantRes.text();
                console.error(`[Enrichment] Failed to issue AccessGrant: ${grantRes.status} ${errBody}`);
            }
        }
        catch (err) {
            console.error('[Enrichment] Failed to issue AccessGrant:', err);
            // Fallback: proceed without grant (worker will use mock/env key)
        }
        // 3. Queue the job
        await queue_1.enrichmentQueue.add('enrichment', {
            enrichmentRunId: run.id,
            uploadJobId: job.id,
            orgId: session.orgId,
            s3Key: job.s3Key,
            accessGrantToken,
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
    /**
     * Gap 5 fix: Manual SEO generation trigger.
     * Per BR-SV-06, SEO is only allowed after EnrichmentRun.status = 'completed'.
     * ADR-004: Long-running tasks must go through queue.
     */
    fastify.post('/uploads/:id/seo/start', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const { lang = 'ru' } = request.body || {};
        if (!(0, shared_auth_1.hasPermission)(session, 'enrichment:start')) {
            return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
        }
        // 1. Verify upload job exists and belongs to this tenant
        const job = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId))
        });
        if (!job) {
            return reply.status(404).send({ error: 'Upload job not found' });
        }
        // 2. Find the latest completed enrichment run (BR-SV-06)
        const run = await shared_db_1.db.query.enrichmentRuns.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.jobId, id), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.orgId, session.orgId), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.status, 'completed')),
            orderBy: (runs, { desc }) => [desc(runs.createdAt)],
        });
        if (!run) {
            return reply.status(400).send({
                error: 'No completed enrichment run found. SEO generation requires a completed enrichment run.'
            });
        }
        // 3. Create SEO task
        const [seoTask] = await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            return tx.insert(shared_db_1.seoTasks).values({
                orgId: session.orgId,
                uploadId: id,
                runId: run.id,
                status: 'queued',
                lang,
                totalItems: run.processedItems,
            }).returning();
        });
        // 4. Issue AccessGrant for the worker (ADR-003)
        let accessGrantToken;
        try {
            const grantRes = await fetch(`${CP_URL}/api/v1/grants/issue-internal`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SERVICE_TOKEN}`
                },
                body: JSON.stringify({
                    serviceSlug: 'csv-service-worker',
                    scopes: ['secret:read', 'seo:write'],
                    orgId: session.orgId
                })
            });
            if (grantRes.ok) {
                const grantData = await grantRes.json();
                accessGrantToken = grantData.token;
                console.log('[SEO] AccessGrant issued successfully');
            }
            else {
                const errBody = await grantRes.text();
                console.error(`[SEO] Failed to issue AccessGrant: ${grantRes.status} ${errBody}`);
            }
        }
        catch (err) {
            console.error('[SEO] Failed to issue AccessGrant:', err);
        }
        // 5. Enqueue SEO job (ADR-004: long-running tasks via queue)
        const redisConn = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
        });
        const seoQueue = new bullmq_1.Queue('seo-generation', { connection: redisConn });
        await seoQueue.add('seo-generation', {
            seoTaskId: seoTask.id,
            uploadJobId: id,
            enrichmentRunId: run.id,
            orgId: session.orgId,
            lang,
            accessGrantToken,
        });
        return {
            success: true,
            seoTaskId: seoTask.id,
        };
    });
}
//# sourceMappingURL=enrichment.js.map