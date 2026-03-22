"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collisionsRoutes = collisionsRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
async function collisionsRoutes(fastify) {
    // List collisions for a job
    fastify.get('/projects/:projectId/jobs/:jobId/collisions', async (request, reply) => {
        const session = request.userSession;
        const { projectId, jobId } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'collision:read')) {
            return reply.status(403).send({ error: 'Forbidden: collision:read required' });
        }
        const jobCollisions = await shared_db_1.db.query.collisions.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.jobId, jobId), (0, shared_db_1.eq)(shared_db_1.collisions.orgId, session.orgId)),
            with: {
                item: true
            }
        });
        return jobCollisions;
    });
    // Resolve a collision
    fastify.post('/collisions/:id/resolve', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        const { resolvedValue } = request.body;
        if (!(0, shared_auth_1.hasPermission)(session, 'collision:resolve')) {
            return reply.status(403).send({ error: 'Forbidden: collision:resolve required' });
        }
        const collision = await shared_db_1.db.query.collisions.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.id, id), (0, shared_db_1.eq)(shared_db_1.collisions.orgId, session.orgId))
        });
        if (!collision) {
            return reply.status(404).send({ error: 'Collision not found' });
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            // 1. Update collision record
            await tx.update(shared_db_1.collisions)
                .set({
                status: 'resolved',
                resolvedValue: JSON.stringify(resolvedValue),
                resolvedBy: session.userId,
                resolvedAt: new Date()
            })
                .where((0, shared_db_1.eq)(shared_db_1.collisions.id, id));
            // 2. Update enriched item data
            const item = await tx.query.enrichedItems.findFirst({
                where: (0, shared_db_1.eq)(shared_db_1.enrichedItems.id, collision.enrichedItemId)
            });
            if (item) {
                const enrichedData = JSON.parse(item.enrichedData || '{}');
                enrichedData[collision.field] = resolvedValue;
                await tx.update(shared_db_1.enrichedItems)
                    .set({
                    enrichedData: JSON.stringify(enrichedData),
                    status: 'manual_override',
                    reviewedBy: session.userId,
                    reviewedAt: new Date()
                })
                    .where((0, shared_db_1.eq)(shared_db_1.enrichedItems.id, item.id));
            }
            // 3. Audit Log
            await tx.insert(shared_db_1.auditLogs).values({
                orgId: session.orgId,
                userId: session.userId,
                action: 'collision_resolved',
                resourceType: 'collision',
                resourceId: collision.id,
                payload: JSON.stringify({ field: collision.field, resolvedValue }),
            });
            // 4. Check if all collisions for this job are resolved
            const [remaining] = await tx.select({ value: (0, shared_db_1.count)() })
                .from(shared_db_1.collisions)
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.collisions.status, 'detected')));
            if (remaining.value === 0) {
                await tx.update(shared_db_1.uploadJobs)
                    .set({ status: 'ready', updatedAt: new Date() })
                    .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, collision.jobId));
            }
        });
        return { success: true };
    });
    // Dismiss a collision
    fastify.post('/collisions/:id/dismiss', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'collision:resolve')) {
            return reply.status(403).send({ error: 'Forbidden: collision:resolve required' });
        }
        const collision = await shared_db_1.db.query.collisions.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.id, id), (0, shared_db_1.eq)(shared_db_1.collisions.orgId, session.orgId))
        });
        if (!collision) {
            return reply.status(404).send({ error: 'Collision not found' });
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            await tx.update(shared_db_1.collisions)
                .set({
                status: 'dismissed',
                resolvedBy: session.userId,
                resolvedAt: new Date()
            })
                .where((0, shared_db_1.eq)(shared_db_1.collisions.id, id));
            // Audit Log
            await tx.insert(shared_db_1.auditLogs).values({
                orgId: session.orgId,
                userId: session.userId,
                action: 'collision_dismissed',
                resourceType: 'collision',
                resourceId: collision.id,
                payload: JSON.stringify({ field: collision.field }),
            });
            // Check if all collisions for this job are resolved/dismissed
            const [remaining] = await tx.select({ value: (0, shared_db_1.count)() })
                .from(shared_db_1.collisions)
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.collisions.status, 'detected')));
            if (remaining.value === 0) {
                await tx.update(shared_db_1.uploadJobs)
                    .set({ status: 'ready', updatedAt: new Date() })
                    .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, collision.jobId));
            }
        });
        return { success: true };
    });
}
//# sourceMappingURL=collisions.js.map