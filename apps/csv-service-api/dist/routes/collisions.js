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
        // Normalize resolvedValue to a string for consistent storage
        const resolvedValueStr = typeof resolvedValue === 'string' ? resolvedValue : JSON.stringify(resolvedValue);
        // Warn if the field is enum type and resolvedValue is not in allowedValues
        try {
            const template = await shared_db_1.db.query.schemaTemplates.findFirst({
                where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.orgId, session.orgId)),
                with: { fields: true }
            });
            if (template) {
                const schemaField = template.fields.find((f) => f.name === collision.field);
                if (schemaField && schemaField.fieldType === 'enum' && Array.isArray(schemaField.allowedValues) && schemaField.allowedValues.length > 0) {
                    if (!schemaField.allowedValues.includes(resolvedValueStr)) {
                        console.warn(`[Collision Resolve] resolvedValue "${resolvedValueStr}" is not in allowedValues for enum field "${collision.field}". Allowed: ${schemaField.allowedValues.join(', ')}`);
                    }
                }
            }
        }
        catch (err) {
            console.warn('[Collision Resolve] Failed to validate enum allowedValues:', err);
        }
        await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            // 1. Update collision record
            await tx.update(shared_db_1.collisions)
                .set({
                status: 'resolved',
                resolvedValue: resolvedValueStr,
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
            // 3.5 Save to cross-org knowledge base (correction = human fixed AI)
            if (item && collision.originalValue !== resolvedValueStr) {
                // Extract product context from rawData for future matching
                let inputContext = '';
                try {
                    const raw = JSON.parse(item.rawData || '{}');
                    inputContext = raw.name || raw['Имя [Ru]'] || raw['Название'] || raw.title || '';
                    if (!inputContext)
                        inputContext = Object.values(raw).find((v) => typeof v === 'string' && v.length > 3 && v.length < 200) || '';
                }
                catch { /* ignore */ }
                if (inputContext) {
                    await tx.insert(shared_db_1.enrichmentKnowledge).values({
                        orgId: session.orgId,
                        fieldName: collision.field,
                        productCategory: null, // TODO: could be extracted from catalog analysis
                        inputContext: String(inputContext).slice(0, 500),
                        aiValue: collision.originalValue,
                        correctValue: resolvedValueStr,
                        source: 'correction',
                    });
                }
            }
            // 4. Check if all collisions for this job are resolved/dismissed
            // Per state_machines.md: count both 'detected' and 'pending_review' as open
            const [remaining] = await tx.select({ value: (0, shared_db_1.count)() })
                .from(shared_db_1.collisions)
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.collisions.orgId, session.orgId), (0, shared_db_1.or)((0, shared_db_1.eq)(shared_db_1.collisions.status, 'detected'), (0, shared_db_1.eq)(shared_db_1.collisions.status, 'pending_review'))));
            if (remaining.value === 0) {
                // Complete collision review task
                await tx.update(shared_db_1.reviewTasks)
                    .set({ status: 'completed', completedBy: session.userId, completedAt: new Date() })
                    .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.reviewTasks.taskType, 'collision_review'), (0, shared_db_1.eq)(shared_db_1.reviewTasks.status, 'pending')));
                await tx.update(shared_db_1.uploadJobs)
                    .set({ status: 'ready', updatedAt: new Date() })
                    .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, collision.jobId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId)));
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
            // Canonical model: dismiss → 'ignored' (not 'dismissed')
            await tx.update(shared_db_1.collisions)
                .set({
                status: 'ignored',
                resolvedBy: session.userId,
                resolvedAt: new Date()
            })
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.id, id), (0, shared_db_1.eq)(shared_db_1.collisions.orgId, session.orgId)));
            // Audit Log
            await tx.insert(shared_db_1.auditLogs).values({
                orgId: session.orgId,
                userId: session.userId,
                actorType: 'user',
                action: 'collision.dismissed',
                resourceType: 'collision',
                resourceId: collision.id,
                payload: JSON.stringify({ field: collision.field }),
            });
            // Check if all open collisions for this job are resolved/ignored
            // Per state_machines.md: count 'detected' and 'pending_review' as still open
            const [remaining] = await tx.select({ value: (0, shared_db_1.count)() })
                .from(shared_db_1.collisions)
                .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.collisions.orgId, session.orgId), (0, shared_db_1.or)((0, shared_db_1.eq)(shared_db_1.collisions.status, 'detected'), (0, shared_db_1.eq)(shared_db_1.collisions.status, 'pending_review'))));
            if (remaining.value === 0) {
                // Complete collision review task
                await tx.update(shared_db_1.reviewTasks)
                    .set({ status: 'completed', completedBy: session.userId, completedAt: new Date() })
                    .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, collision.jobId), (0, shared_db_1.eq)(shared_db_1.reviewTasks.taskType, 'collision_review'), (0, shared_db_1.eq)(shared_db_1.reviewTasks.status, 'pending')));
                await tx.update(shared_db_1.uploadJobs)
                    .set({ status: 'ready', updatedAt: new Date() })
                    .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, collision.jobId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, session.orgId)));
            }
        });
        return { success: true };
    });
    // Knowledge base stats — most frequently corrected fields
    fastify.get('/knowledge/stats', async (request, reply) => {
        const session = request.userSession;
        if (!(0, shared_auth_1.hasPermission)(session, 'upload:read')) {
            return reply.status(403).send({ error: 'Forbidden' });
        }
        // Cross-org: count corrections by field_name
        const stats = await shared_db_1.db
            .select({
            fieldName: shared_db_1.enrichmentKnowledge.fieldName,
            corrections: (0, shared_db_1.count)(),
        })
            .from(shared_db_1.enrichmentKnowledge)
            .where((0, shared_db_1.eq)(shared_db_1.enrichmentKnowledge.source, 'correction'))
            .groupBy(shared_db_1.enrichmentKnowledge.fieldName)
            .orderBy((0, shared_db_1.desc)((0, shared_db_1.count)()))
            .limit(15);
        const totalKnowledge = await shared_db_1.db
            .select({ value: (0, shared_db_1.count)() })
            .from(shared_db_1.enrichmentKnowledge);
        return {
            topCorrectedFields: stats.map(s => ({ field: s.fieldName, corrections: Number(s.corrections) })),
            totalEntries: Number(totalKnowledge[0]?.value || 0),
        };
    });
}
//# sourceMappingURL=collisions.js.map