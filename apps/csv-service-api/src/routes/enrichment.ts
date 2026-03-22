import { FastifyInstance } from 'fastify';
import { db, uploadJobs, schemaTemplates, enrichmentRuns, eq, and, withTenant } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';
import { enrichmentQueue } from '../lib/queue';

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

    // 3. Queue the job
    await enrichmentQueue.add('enrichment', {
      enrichmentRunId: run.id,
      uploadJobId: job.id,
      orgId: session.orgId,
      s3Key: job.s3Key
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
}
