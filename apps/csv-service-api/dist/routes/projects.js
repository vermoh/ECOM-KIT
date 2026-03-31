"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectRoutes = projectRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
async function projectRoutes(fastify) {
    // List projects for the organization
    fastify.get('/projects', async (request, reply) => {
        const session = request.userSession;
        if (!(0, shared_auth_1.hasPermission)(session, 'project:read')) {
            return reply.status(403).send({ error: 'Forbidden: project:read required' });
        }
        const orgProjects = await shared_db_1.db.query.projects.findMany({
            where: (0, shared_db_1.eq)(shared_db_1.projects.orgId, session.orgId),
            orderBy: (proj, { desc }) => [desc(proj.createdAt)]
        });
        const projectIds = orgProjects.map(p => p.id);
        let allJobs = [];
        if (projectIds.length > 0) {
            allJobs = await shared_db_1.db.select({
                projectId: shared_db_1.uploadJobs.projectId,
                status: shared_db_1.uploadJobs.status,
                createdAt: shared_db_1.uploadJobs.createdAt
            })
                .from(shared_db_1.uploadJobs)
                .where((0, shared_db_1.inArray)(shared_db_1.uploadJobs.projectId, projectIds));
        }
        const mappedProjects = orgProjects.map(p => {
            const pJobs = allJobs.filter(j => j.projectId === p.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return {
                id: p.id,
                orgId: p.orgId,
                name: p.name,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
                status: pJobs.length > 0 ? pJobs[0].status.toUpperCase() : 'PENDING'
            };
        });
        return mappedProjects;
    });
    // Create a new project
    fastify.post('/projects', async (request, reply) => {
        const session = request.userSession;
        const { name } = request.body;
        if (!(0, shared_auth_1.hasPermission)(session, 'project:create')) {
            return reply.status(403).send({ error: 'Forbidden: project:create required' });
        }
        if (!name) {
            return reply.status(400).send({ error: 'Project name is required' });
        }
        const [newProject] = await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
            return tx.insert(shared_db_1.projects).values({
                orgId: session.orgId,
                name
            }).returning();
        });
        return newProject;
    });
    // Get project by ID
    fastify.get('/projects/:id', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'project:read')) {
            return reply.status(403).send({ error: 'Forbidden: project:read required' });
        }
        const project = await shared_db_1.db.query.projects.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.projects.id, id), (0, shared_db_1.eq)(shared_db_1.projects.orgId, session.orgId))
        });
        if (!project) {
            return reply.status(404).send({ error: 'Project not found' });
        }
        return project;
    });
    // Delete project
    fastify.delete('/projects/:id', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        // To prevent unauthorized deletions, require project:create (since we don't have project:delete)
        if (!(0, shared_auth_1.hasPermission)(session, 'project:create')) {
            return reply.status(403).send({ error: 'Forbidden: project:create required' });
        }
        const { schemaTemplates, schemaFields, reviewTasks, enrichmentRuns, enrichedItems, collisions, exportJobs, seoTasks, auditLogs } = await import('@ecom-kit/shared-db');
        try {
            await (0, shared_db_1.withTenant)(session.orgId, async (tx) => {
                // Find all upload jobs
                const jobs = await tx.select({ id: shared_db_1.uploadJobs.id }).from(shared_db_1.uploadJobs).where((0, shared_db_1.eq)(shared_db_1.uploadJobs.projectId, id));
                const jobIds = jobs.map((j) => j.id);
                if (jobIds.length > 0) {
                    // Find schema templates
                    const templates = await tx.select({ id: schemaTemplates.id }).from(schemaTemplates).where((0, shared_db_1.inArray)(schemaTemplates.jobId, jobIds));
                    const templateIds = templates.map((t) => t.id);
                    // Find enrichment runs
                    const runs = await tx.select({ id: enrichmentRuns.id }).from(enrichmentRuns).where((0, shared_db_1.inArray)(enrichmentRuns.jobId, jobIds));
                    const runIds = runs.map((r) => r.id);
                    // 1. Delete things that depend on other child tables
                    await tx.delete(collisions).where((0, shared_db_1.inArray)(collisions.jobId, jobIds));
                    await tx.delete(seoTasks).where((0, shared_db_1.inArray)(seoTasks.uploadId, jobIds));
                    await tx.delete(exportJobs).where((0, shared_db_1.inArray)(exportJobs.uploadId, jobIds));
                    if (runIds.length > 0) {
                        // 2. Delete enriched items (now collisions are gone)
                        await tx.delete(enrichedItems).where((0, shared_db_1.inArray)(enrichedItems.runId, runIds));
                    }
                    // 3. Delete enrichment runs (must be before schemaTemplates, as it references schemaId)
                    await tx.delete(enrichmentRuns).where((0, shared_db_1.inArray)(enrichmentRuns.jobId, jobIds));
                    if (templateIds.length > 0) {
                        // 4. Delete schema fields
                        await tx.delete(schemaFields).where((0, shared_db_1.inArray)(schemaFields.schemaId, templateIds));
                        // 5. Delete schema templates
                        await tx.delete(schemaTemplates).where((0, shared_db_1.inArray)(schemaTemplates.id, templateIds));
                    }
                    // 6. Delete other direct children of uploadJobs
                    await tx.delete(reviewTasks).where((0, shared_db_1.inArray)(reviewTasks.jobId, jobIds));
                    // 7. Finally delete the upload jobs themselves
                    await tx.delete(shared_db_1.uploadJobs).where((0, shared_db_1.inArray)(shared_db_1.uploadJobs.id, jobIds));
                }
                // Delete the project
                const [deletedProject] = await tx.delete(shared_db_1.projects).where((0, shared_db_1.eq)(shared_db_1.projects.id, id)).returning({ name: shared_db_1.projects.name });
                if (deletedProject) {
                    await tx.insert(auditLogs).values({
                        orgId: session.orgId,
                        userId: session.userId,
                        action: 'project.delete',
                        resourceType: 'project',
                        resourceId: id,
                        payload: JSON.stringify({ name: deletedProject.name })
                    });
                }
            });
            return reply.status(204).send();
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to delete project', details: err.message });
        }
    });
}
//# sourceMappingURL=projects.js.map