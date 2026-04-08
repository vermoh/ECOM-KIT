import { FastifyInstance } from 'fastify';
import { db, uploadJobs, schemaTemplates, schemaFields, enrichmentRuns, seoTasks, withTenant, eq, and } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';
import { enrichmentQueue, enrichmentPreviewQueue, ENRICHMENT_PREVIEW_QUEUE } from '../lib/queue';
import IORedis from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';

const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4000';
const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';

export async function enrichmentRoutes(fastify: FastifyInstance) {
  
  // Start enrichment process
  fastify.post('/uploads/:id/enrichment/start', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'enrichment:start')) {
      return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
    }

    // 1. Verify job exists and state is SCHEMA_CONFIRMED
    const job = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, id), eq(uploadJobs.orgId, session.orgId)),
      with: {
        schemaTemplates: {
          where: eq(schemaTemplates.status, 'confirmed'),
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
    const [run] = await withTenant(session.orgId, async (tx) => {
      return tx.insert(enrichmentRuns).values({
        orgId: session.orgId,
        jobId: job.id,
        schemaId: confirmedSchema.id,
        status: 'queued',
        totalItems: job.rowCount || 0,
      }).returning();
    });

    // 2.5 Issue AccessGrant for the worker
    let accessGrantToken: string | undefined;
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
        const grantData = await grantRes.json() as any;
        accessGrantToken = grantData.token;
        console.log('[Enrichment] AccessGrant issued successfully');
      } else {
        const errBody = await grantRes.text();
        console.error(`[Enrichment] Failed to issue AccessGrant: ${grantRes.status} ${errBody}`);
      }
    } catch (err) {
      console.error('[Enrichment] Failed to issue AccessGrant:', err);
      // Fallback: proceed without grant (worker will use mock/env key)
    }

    // 3. Queue the job
    await enrichmentQueue.add('enrichment', {
      enrichmentRunId: run.id,
      uploadJobId: job.id,
      orgId: session.orgId,
      s3Key: job.s3Key,
      accessGrantToken,
    });

    // 4. Update UploadJob status
    await withTenant(session.orgId, async (tx) => {
      await tx.update(uploadJobs)
        .set({ status: 'enriching', updatedAt: new Date() })
        .where(eq(uploadJobs.id, id));
    });

    return { 
      success: true, 
      enrichmentRunId: run.id 
    };
  });

  // Preview enrichment: enrich 5 sample rows without creating a run
  fastify.post('/uploads/:id/enrichment/preview', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { sampleCount = 5 } = (request.body as { sampleCount?: number }) || {};

    if (!hasPermission(session, 'enrichment:start')) {
      return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
    }

    // Verify job exists and has confirmed schema
    const job = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, id), eq(uploadJobs.orgId, session.orgId)),
    });

    if (!job) {
      return reply.status(404).send({ error: 'Upload job not found' });
    }

    const allowedStatuses = ['schema_draft', 'schema_review', 'schema_confirmed', 'enriching', 'enriched', 'needs_collision_review', 'ready'];
    if (!allowedStatuses.includes(job.status)) {
      return reply.status(400).send({ error: `Job must have a schema (current: ${job.status})` });
    }

    // For preview, accept any schema (draft or confirmed)
    const template = await db.query.schemaTemplates.findFirst({
      where: and(eq(schemaTemplates.jobId, id), eq(schemaTemplates.orgId, session.orgId)),
      with: { fields: true },
      orderBy: (t, { desc }) => [desc(t.createdAt)]
    });

    if (!template || !template.fields?.length) {
      return reply.status(400).send({ error: 'No schema template with fields found for this job' });
    }

    // Issue AccessGrant for the worker
    let accessGrantToken: string | undefined;
    try {
      const grantRes = await fetch(`${CP_URL}/api/v1/grants/issue-internal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_TOKEN}`
        },
        body: JSON.stringify({
          serviceSlug: 'csv-service-worker',
          scopes: ['secret:read'],
          orgId: session.orgId
        })
      });
      if (grantRes.ok) {
        const grantData = await grantRes.json() as any;
        accessGrantToken = grantData.token;
      }
    } catch (err) {
      console.error('[Preview] Failed to issue AccessGrant:', err);
    }

    // Enqueue preview job and wait for result
    const previewJob = await enrichmentPreviewQueue.add('enrichment-preview', {
      uploadJobId: id,
      orgId: session.orgId,
      s3Key: job.s3Key,
      schemaId: template.id,
      sampleCount: Math.min(Math.max(sampleCount, 1), 10),
      accessGrantToken,
    });

    try {
      const redisConn = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      });
      const queueEvents = new QueueEvents(ENRICHMENT_PREVIEW_QUEUE, { connection: redisConn as any });
      const result = await previewJob.waitUntilFinished(queueEvents, 60000); // 60s timeout
      await queueEvents.close();
      await redisConn.quit();
      return result;
    } catch (err: any) {
      return reply.status(504).send({ error: 'Preview timed out or failed', details: err.message });
    }
  });

  // Get enrichment run status
  fastify.get('/enrichment/runs/:runId', async (request, reply) => {
    const session = request.userSession!;
    const { runId } = request.params as { runId: string };

    const run = await db.query.enrichmentRuns.findFirst({
      where: and(eq(enrichmentRuns.id, runId), eq(enrichmentRuns.orgId, session.orgId))
    });

    if (!run) {
      return reply.status(404).send({ error: 'Enrichment run not found' });
    }

    return run;
  });

  // Get SEO task status
  fastify.get('/uploads/:id/seo', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    const task = await db.query.seoTasks.findFirst({
      where: and(eq(seoTasks.uploadId, id), eq(seoTasks.orgId, session.orgId)),
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
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { lang = 'ru' } = (request.body as { lang?: string }) || {};

    if (!hasPermission(session, 'enrichment:start')) {
      return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
    }

    // 1. Verify upload job exists and belongs to this tenant
    const job = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, id), eq(uploadJobs.orgId, session.orgId))
    });

    if (!job) {
      return reply.status(404).send({ error: 'Upload job not found' });
    }

    // 2. Find the latest completed enrichment run (BR-SV-06)
    const run = await db.query.enrichmentRuns.findFirst({
      where: and(
        eq(enrichmentRuns.jobId, id),
        eq(enrichmentRuns.orgId, session.orgId),
        eq(enrichmentRuns.status, 'completed')
      ),
      orderBy: (runs, { desc }) => [desc(runs.createdAt)],
    });

    if (!run) {
      return reply.status(400).send({
        error: 'No completed enrichment run found. SEO generation requires a completed enrichment run.'
      });
    }

    // 3. Create SEO task
    const [seoTask] = await withTenant(session.orgId, async (tx) => {
      return tx.insert(seoTasks).values({
        orgId: session.orgId,
        uploadId: id,
        runId: run.id,
        status: 'queued',
        lang,
        totalItems: run.processedItems,
      }).returning();
    });

    // 4. Issue AccessGrant for the worker (ADR-003)
    let accessGrantToken: string | undefined;
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
        const grantData = await grantRes.json() as any;
        accessGrantToken = grantData.token;
        console.log('[SEO] AccessGrant issued successfully');
      } else {
        const errBody = await grantRes.text();
        console.error(`[SEO] Failed to issue AccessGrant: ${grantRes.status} ${errBody}`);
      }
    } catch (err) {
      console.error('[SEO] Failed to issue AccessGrant:', err);
    }

    // 5. Enqueue SEO job (ADR-004: long-running tasks via queue)
    const redisConn = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    const seoQueue = new Queue('seo-generation', { connection: redisConn as any });
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
