import { FastifyInstance } from 'fastify';
import { db, reviewTasks, eq, and } from '@ecom-kit/shared-db';
import { hasPermission } from '@ecom-kit/shared-auth';

export async function taskRoutes(fastify: FastifyInstance) {
  
  // Get all tasks for an upload job
  fastify.get('/uploads/:id/tasks', async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as { id: string };

    if (!hasPermission(session, 'schema:read')) { // Using schema:read as a proxy for reading tasks
      return reply.status(403).send({ error: 'PERMISSION_DENIED' });
    }

    const tasks = await db.query.reviewTasks.findMany({
      where: and(
        eq(reviewTasks.jobId, id),
        eq(reviewTasks.orgId, session.orgId)
      ),
      orderBy: (tasks, { desc }) => [desc(tasks.createdAt)]
    });

    return tasks;
  });
}
