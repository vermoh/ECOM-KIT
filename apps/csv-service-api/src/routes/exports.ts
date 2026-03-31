import { FastifyInstance } from 'fastify';
import { db, exportJobs, uploadJobs, projects, auditLogs, eq, and, withTenant } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';
import { exportQueue } from '../lib/queue';
import { v4 as uuidv4 } from 'uuid';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from '../lib/s3';

export async function exportRoutes(fastify: FastifyInstance) {
  
  // Trigger a new export
  fastify.post('/projects/:projectId/uploads/:uploadId/export', async (request, reply) => {
    const session = request.userSession!;
    const { projectId, uploadId } = request.params as { projectId: string, uploadId: string };
    const { includeSeo = false } = (request.body as { includeSeo?: boolean }) || {};

    if (!hasPermission(session, 'export:create')) {
      return reply.status(403).send({ error: 'Forbidden: export:create required' });
    }

    // Verify project and upload exist and belong to org
    const upload = await db.query.uploadJobs.findFirst({
      where: and(
        eq(uploadJobs.id, uploadId),
        eq(uploadJobs.projectId, projectId),
        eq(uploadJobs.orgId, session.orgId)
      )
    });

    if (!upload) {
      return reply.status(404).send({ error: 'Upload not found' });
    }

    if (upload.status !== 'ready' && upload.status !== 'done') {
      return reply.status(400).send({ error: 'Upload is not ready for export. Current status: ' + upload.status });
    }

    const exportJobId = uuidv4();

    // Create ExportJob
    const [job] = await withTenant(session.orgId, async (tx) => {
      // Update upload status to exporting
      await tx.update(uploadJobs)
        .set({ status: 'exporting', updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadId));

      return tx.insert(exportJobs).values({
        id: exportJobId,
        orgId: session.orgId,
        uploadId,
        requestedBy: session.userId,
        status: 'queued',
        includeSeo,
      }).returning();
    });

    // Audit Log
    await withTenant(session.orgId, async (tx) => {
      await tx.insert(auditLogs).values({
        orgId: session.orgId,
        userId: session.userId,
        action: 'export.started',
        resourceType: 'upload_job',
        resourceId: uploadId,
        payload: JSON.stringify({ exportJobId, includeSeo }),
      });
    });

    // Add to export queue
    await exportQueue.add('export', {
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
    const session = request.userSession!;
    const { id, uploadId } = request.params as { id: string, uploadId: string };

    if (!hasPermission(session, 'export:read')) {
      return reply.status(403).send({ error: 'Forbidden: export:read required' });
    }

    const job = await db.query.exportJobs.findFirst({
      where: and(
        eq(exportJobs.id, id),
        eq(exportJobs.uploadId, uploadId),
        eq(exportJobs.orgId, session.orgId)
      )
    });

    if (!job) {
      return reply.status(404).send({ error: 'Export job not found' });
    }

    return job;
  });

  // Download export — stream the file directly from S3 through the API
  fastify.get('/projects/:projectId/uploads/:uploadId/exports/:id/download', async (request, reply) => {
    const session = request.userSession!;
    const { id, uploadId } = request.params as { id: string; uploadId: string };

    if (!hasPermission(session, 'export:read')) {
      return reply.status(403).send({ error: 'Forbidden: export:read required' });
    }

    const job = await db.query.exportJobs.findFirst({
      where: and(
        eq(exportJobs.id, id),
        eq(exportJobs.uploadId, uploadId),
        eq(exportJobs.orgId, session.orgId)
      )
    });

    if (!job) {
      return reply.status(404).send({ error: 'Export job not found' });
    }

    if (job.status !== 'ready' || !job.s3Key) {
      return reply.status(400).send({ error: 'Export is not ready for download' });
    }

    // Fetch file from S3 and send as buffer
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: job.s3Key,
    }));

    const bodyBytes = await s3Response.Body!.transformToByteArray();
    const buffer = Buffer.from(bodyBytes);

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="enriched_export.csv"');
    reply.header('Content-Length', buffer.length);

    return reply.send(buffer);
  });

  // List exports for an upload
  fastify.get('/projects/:projectId/uploads/:uploadId/exports', async (request, reply) => {
    const session = request.userSession!;
    const { uploadId } = request.params as { uploadId: string };

    if (!hasPermission(session, 'export:read')) {
      return reply.status(403).send({ error: 'Forbidden: export:read required' });
    }

    const jobs = await db.query.exportJobs.findMany({
      where: and(
        eq(exportJobs.uploadId, uploadId),
        eq(exportJobs.orgId, session.orgId)
      ),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)]
    });

    return jobs;
  });
}
