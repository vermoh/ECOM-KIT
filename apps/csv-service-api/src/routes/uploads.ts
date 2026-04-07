import { FastifyInstance } from 'fastify';
import { db, uploadJobs, projects, enrichmentRuns, eq, and, withTenant } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';
import { s3Client, s3PublicClient, BUCKET_NAME } from '../lib/s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { csvParsingQueue } from '../lib/queue';

const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4000';
const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';

export async function uploadRoutes(fastify: FastifyInstance) {
  
  // Request a pre-signed URL for CSV upload
  fastify.post('/projects/:projectId/uploads', async (request, reply) => {
    const session = request.userSession!;
    const { projectId } = request.params as { projectId: string };
    const { filename, includeSeo, catalogContext, lang } = request.body as { filename: string; includeSeo?: boolean; catalogContext?: string; lang?: string };

    if (!hasPermission(session, 'upload:create')) {
      return reply.status(403).send({ error: 'Forbidden: upload:create required' });
    }

    if (!filename) {
      return reply.status(400).send({ error: 'Filename is required' });
    }

    // Verify project exists and belongs to org
    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, projectId),
        eq(projects.orgId, session.orgId)
      )
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const uploadJobId = uuidv4();
    const s3Key = `${session.orgId}/${projectId}/${uploadJobId}/${filename}`;

    // Create UploadJob in PENDING status
    const [job] = await db.insert(uploadJobs).values({
      id: uploadJobId,
      orgId: session.orgId,
      projectId,
      status: 'pending',
      s3Key,
      originalFilename: filename,
      includeSeo: includeSeo || false,
      catalogContext: catalogContext || null,
      lang: lang || null,
    }).returning();

    // Generate Pre-signed URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: 'text/csv',
    });

    const presignedUrl = await getSignedUrl(s3PublicClient, command, { expiresIn: 3600 });

    return {
      uploadJobId: job.id,
      presignedUrl,
      s3Key
    };
  });

  // Get upload job status
  fastify.get('/uploads/:id', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'upload:read')) {
      return reply.status(403).send({ error: 'Forbidden: upload:read required' });
    }

    const job = await db.query.uploadJobs.findFirst({
      where: and(
        eq(uploadJobs.id, id),
        eq(uploadJobs.orgId, session.orgId)
      )
    });

    if (!job) {
      return reply.status(404).send({ error: 'Upload job not found' });
    }

    const latestRun = await db.query.enrichmentRuns.findFirst({
      where: and(eq(enrichmentRuns.jobId, job.id), eq(enrichmentRuns.orgId, session.orgId)),
      orderBy: (runs, { desc }) => [desc(runs.createdAt)],
    });

    return {
      ...job,
      enrichmentRun: latestRun || null
    };
  });

  // List uploads for a project
  fastify.get('/projects/:projectId/uploads', async (request, reply) => {
    const session = request.userSession!;
    const { projectId } = request.params as { projectId: string };

    if (!hasPermission(session, 'upload:read')) {
      return reply.status(403).send({ error: 'Forbidden: upload:read required' });
    }

    const jobs = await db.query.uploadJobs.findMany({
      where: and(
        eq(uploadJobs.projectId, projectId),
        eq(uploadJobs.orgId, session.orgId)
      ),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)]
    });

    return jobs;
  });

  // Start processing an upload
  fastify.post('/uploads/:id/start', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { includeSeo } = request.body as { includeSeo?: boolean };

    if (!hasPermission(session, 'enrichment:start')) {
      return reply.status(403).send({ error: 'Forbidden: enrichment:start required' });
    }

    const job = await db.query.uploadJobs.findFirst({
      where: and(
        eq(uploadJobs.id, id),
        eq(uploadJobs.orgId, session.orgId)
      )
    });

    if (!job) {
      return reply.status(404).send({ error: 'Upload job not found' });
    }

    if (job.status !== 'pending' && job.status !== 'failed') {
      return reply.status(400).send({ error: 'Job already in progress or completed' });
    }

    // Issue a proper AccessGrant token for the worker (instead of passing the user's JWT)
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
        console.log('[Upload] AccessGrant issued successfully for parsing job');
      } else {
        const errBody = await grantRes.text();
        console.error(`[Upload] Failed to issue AccessGrant: ${grantRes.status} ${errBody}`);
      }
    } catch (err) {
      console.error('[Upload] Failed to issue AccessGrant:', err);
    }

    // Add to parsing queue
    await csvParsingQueue.add('csv-parsing', {
      uploadJobId: job.id,
      orgId: session.orgId,
      s3Key: job.s3Key,
      accessGrantToken
    });

    // Update status to pending (redundant but sets updatedAt)
    await withTenant(session.orgId, async (tx) => {
      const updateData: any = { status: 'pending', updatedAt: new Date() };
      if (includeSeo !== undefined) {
        updateData.includeSeo = includeSeo;
      }
      await tx.update(uploadJobs)
        .set(updateData)
        .where(eq(uploadJobs.id, id));
    });

    return { success: true };
  });
}
