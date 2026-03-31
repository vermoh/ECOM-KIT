"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemsRoutes = itemsRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
/**
 * Enriched Items Routes
 * Gap 4 fix: expose GET /uploads/:id/items endpoint so frontend
 * can display per-SKU enrichment results with pagination.
 */
async function itemsRoutes(fastify) {
    // List enriched items for an upload job (paginated)
    fastify.get('/uploads/:id/items', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const { limit = '50', offset = '0', status } = request.query;
        if (!(0, shared_auth_1.hasPermission)(session, 'upload:read')) {
            return reply.status(403).send({ error: 'Forbidden: upload:read required' });
        }
        // Verify upload job exists and belongs to this tenant
        const job = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, id), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId))
        });
        if (!job) {
            return reply.status(404).send({ error: 'Upload job not found' });
        }
        const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200); // cap at 200
        const parsedOffset = parseInt(offset, 10) || 0;
        const items = await shared_db_1.db.query.enrichedItems.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichedItems.uploadId, id), (0, shared_db_1.eq)(shared_db_1.enrichedItems.orgId, session.orgId), 
            // optional filter by status
            ...(status ? [(0, shared_db_1.eq)(shared_db_1.enrichedItems.status, status)] : [])),
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
        const session = request.userSession;
        const { id, itemId } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'upload:read')) {
            return reply.status(403).send({ error: 'Forbidden: upload:read required' });
        }
        const item = await shared_db_1.db.query.enrichedItems.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichedItems.id, itemId), (0, shared_db_1.eq)(shared_db_1.enrichedItems.uploadId, id), (0, shared_db_1.eq)(shared_db_1.enrichedItems.orgId, session.orgId)),
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
//# sourceMappingURL=items.js.map