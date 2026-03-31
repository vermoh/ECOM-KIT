import { FastifyInstance } from 'fastify';
import { db, uploadJobs, projects, eq, and, withTenant } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';
import { s3Client, BUCKET_NAME } from '../lib/s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { csvParsingQueue } from '../lib/queue';

export async function uploadRoutes(fastify: FastifyInstance) {
  
  // Request a pre-signed URL for CSV upload
  fastify.post('/projects/:projectId/uploads', async (request, reply) => {
    const session = request.userSession!;
    const { projectId } = request.params as { projectId: string };
    const { filename, includeSeo } = request.body as { filename: string; includeSeo?: boolean };

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
    const [job] = await withTenant(session.orgId, async (tx) => {
      return tx.insert(uploadJobs).values({
        id: uploadJobId,
        orgId: session.orgId,
        projectId,
        status: 'pending',
        s3Key,
        originalFilename: filename,
        includeSeo: includeSeo || false,
      }).returning();
    });

    // Generate Pre-signed URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: 'text/csv',
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

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

    // Add to parsing queue
    await csvParsingQueue.add('csv-parsing', {
      uploadJobId: job.id,
      orgId: session.orgId,
      s3Key: job.s3Key
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
