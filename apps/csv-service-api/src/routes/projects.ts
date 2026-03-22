import { FastifyInstance } from 'fastify';
import { db, projects, eq, and, withTenant } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';

export async function projectRoutes(fastify: FastifyInstance) {
  
  // List projects for the organization
  fastify.get('/projects', async (request, reply) => {
    const session = request.userSession!;
    
    if (!hasPermission(session, 'project:read')) {
      return reply.status(403).send({ error: 'Forbidden: project:read required' });
    }

    const orgProjects = await db.query.projects.findMany({
      where: eq(projects.orgId, session.orgId)
    });

    return orgProjects;
  });

  // Create a new project
  fastify.post('/projects', async (request, reply) => {
    const session = request.userSession!;
    const { name } = request.body as { name: string };

    if (!hasPermission(session, 'project:create')) {
      return reply.status(403).send({ error: 'Forbidden: project:create required' });
    }

    if (!name) {
      return reply.status(400).send({ error: 'Project name is required' });
    }

    const [newProject] = await withTenant(session.orgId, async (tx) => {
      return tx.insert(projects).values({
        orgId: session.orgId,
        name
      }).returning();
    });

    return newProject;
  });

  // Get project by ID
  fastify.get('/projects/:id', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'project:read')) {
      return reply.status(403).send({ error: 'Forbidden: project:read required' });
    }

    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, id),
        eq(projects.orgId, session.orgId)
      )
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return project;
  });
}
