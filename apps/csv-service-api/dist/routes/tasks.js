"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskRoutes = taskRoutes;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_auth_1 = require("@ecom-kit/shared-auth");
async function taskRoutes(fastify) {
    // Get all tasks for an upload job
    fastify.get('/uploads/:id/tasks', async (request, reply) => {
        const session = request.userSession;
        const { id } = request.params;
        if (!(0, shared_auth_1.hasPermission)(session, 'schema:read')) { // Using schema:read as a proxy for reading tasks
            return reply.status(403).send({ error: 'PERMISSION_DENIED' });
        }
        const tasks = await shared_db_1.db.query.reviewTasks.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, id), (0, shared_db_1.eq)(shared_db_1.reviewTasks.orgId, session.orgId)),
            orderBy: (tasks, { desc }) => [desc(tasks.createdAt)]
        });
        return tasks;
    });
}
//# sourceMappingURL=tasks.js.map