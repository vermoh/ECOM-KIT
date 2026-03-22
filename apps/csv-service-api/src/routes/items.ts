import { FastifyInstance } from 'fastify';
import { db, enrichedItems, uploadJobs, eq, and } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';

/**
 * Enriched Items Routes
 * Gap 4 fix: expose GET /uploads/:id/items endpoint so frontend
 * can display per-SKU enrichment results with pagination.
 */
export async function itemsRoutes(fastify: FastifyInstance) {

  // List enriched items for an upload job (paginated)
  fastify.get('/uploads/:id/items', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };
    const { limit = '50', offset = '0', status } = request.query as {
      limit?: string;
      offset?: string;
      status?: string;
    };

    if (!hasPermission(session, 'upload:read')) {
      return reply.status(403).send({ error: 'Forbidden: upload:read required' });
    }

    // Verify upload job exists and belongs to this tenant
    const job = await db.query.uploadJobs.findFirst({
      where: and(
        eq(uploadJobs.id, id),
        eq(uploadJobs.orgId, session.orgId)
      )
    });

    if (!job) {
      return reply.status(404).send({ error: 'Upload job not found' });
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200); // cap at 200
    const parsedOffset = parseInt(offset, 10) || 0;

    const items = await db.query.enrichedItems.findMany({
      where: and(
        eq(enrichedItems.uploadId, id),
        eq(enrichedItems.orgId, session.orgId),
        // optional filter by status
        ...(status ? [eq(enrichedItems.status, status as any)] : [])
      ),
      with: {
        collisions: true,
      },
      orderBy: (items, { asc }) => [asc(items.createdAt)],
      limit: parsedLimit,
      offset: parsedOffset,
    });

    return {
      items,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        total: job.rowCount ?? null,
      }
    };
  });

  // Get a single enriched item by ID
  fastify.get('/uploads/:id/items/:itemId', async (request, reply) => {
    const session = request.userSession!;
    const { id, itemId } = request.params as { id: string; itemId: string };

    if (!hasPermission(session, 'upload:read')) {
      return reply.status(403).send({ error: 'Forbidden: upload:read required' });
    }

    const item = await db.query.enrichedItems.findFirst({
      where: and(
        eq(enrichedItems.id, itemId),
        eq(enrichedItems.uploadId, id),
        eq(enrichedItems.orgId, session.orgId)
      ),
      with: {
        collisions: true,
      },
    });

    if (!item) {
      return reply.status(404).send({ error: 'Enriched item not found' });
    }

    return item;
  });
}
