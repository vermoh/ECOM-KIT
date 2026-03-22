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
            where: (0, shared_db_1.eq)(shared_db_1.projects.orgId, session.orgId)
        });
        return orgProjects;
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
}
//# sourceMappingURL=projects.js.map