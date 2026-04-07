import { FastifyInstance } from 'fastify';
import { db, projects, eq, and, withTenant, uploadJobs, inArray, schemaTemplates, schemaFields, reviewTasks, enrichmentRuns, enrichedItems, collisions, exportJobs, seoTasks, auditLogs } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';

export async function projectRoutes(fastify: FastifyInstance) {
  
  // List projects for the organization
  fastify.get('/projects', async (request, reply) => {
    const session = request.userSession!;
    
    if (!hasPermission(session, 'project:read')) {
      return reply.status(403).send({ error: 'Forbidden: project:read required' });
    }

    const orgProjects = await db.query.projects.findMany({
      where: eq(projects.orgId, session.orgId),
      orderBy: (proj, { desc }) => [desc(proj.createdAt)]
    });

    const projectIds = orgProjects.map(p => p.id);
    
    let allJobs: { projectId: string; status: string; createdAt: Date }[] = [];
    if (projectIds.length > 0) {
      allJobs = await db.select({ 
        projectId: uploadJobs.projectId, 
        status: uploadJobs.status, 
        createdAt: uploadJobs.createdAt 
      })
      .from(uploadJobs)
      .where(inArray(uploadJobs.projectId, projectIds));
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

  // Delete project
  fastify.delete('/projects/:id', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    // To prevent unauthorized deletions, require project:create (since we don't have project:delete)
    if (!hasPermission(session, 'project:create')) {
      return reply.status(403).send({ error: 'Forbidden: project:create required' });
    }

    try {
      await withTenant(session.orgId, async (tx) => {
        // Find all upload jobs
        const jobs = await tx.select({ id: uploadJobs.id }).from(uploadJobs).where(eq(uploadJobs.projectId, id));
        const jobIds = jobs.map((j: { id: string }) => j.id);

        if (jobIds.length > 0) {
          // Find schema templates
          const templates = await tx.select({ id: schemaTemplates.id }).from(schemaTemplates).where(inArray(schemaTemplates.jobId, jobIds));
          const templateIds = templates.map((t: { id: string }) => t.id);

          // Find enrichment runs
          const runs = await tx.select({ id: enrichmentRuns.id }).from(enrichmentRuns).where(inArray(enrichmentRuns.jobId, jobIds));
          const runIds = runs.map((r: { id: string }) => r.id);

          // 1. Delete things that depend on other child tables
          await tx.delete(collisions).where(inArray(collisions.jobId, jobIds));
          await tx.delete(seoTasks).where(inArray(seoTasks.uploadId, jobIds));
          await tx.delete(exportJobs).where(inArray(exportJobs.uploadId, jobIds));
          
          if (runIds.length > 0) {
            // 2. Delete enriched items (now collisions are gone)
            await tx.delete(enrichedItems).where(inArray(enrichedItems.runId, runIds));
          }

          // 3. Delete enrichment runs (must be before schemaTemplates, as it references schemaId)
          await tx.delete(enrichmentRuns).where(inArray(enrichmentRuns.jobId, jobIds));

          if (templateIds.length > 0) {
            // 4. Delete schema fields
            await tx.delete(schemaFields).where(inArray(schemaFields.schemaId, templateIds));
            // 5. Delete schema templates
            await tx.delete(schemaTemplates).where(inArray(schemaTemplates.id, templateIds));
          }

          // 6. Delete other direct children of uploadJobs
          await tx.delete(reviewTasks).where(inArray(reviewTasks.jobId, jobIds));
          
          // 7. Finally delete the upload jobs themselves
          await tx.delete(uploadJobs).where(inArray(uploadJobs.id, jobIds));
        }

        // Delete the project
        const [deletedProject] = await tx.delete(projects).where(eq(projects.id, id)).returning({ name: projects.name });
        
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
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete project', details: err.message });
    }
  });
}
