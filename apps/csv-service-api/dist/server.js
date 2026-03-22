"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const shared_auth_1 = require("@ecom-kit/shared-auth");
const fastify = (0, fastify_1.default)({
    logger: true
});
// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
    this.log.error(error);
    if (error.statusCode === 401 || error.message === 'Invalid token' || error.message === 'Authorization header missing') {
        reply.status(401).send({ error: 'Unauthorized', message: error.message });
    }
    else if (error.statusCode === 403) {
        reply.status(403).send({ error: 'Forbidden' });
    }
    else {
        reply.status(500).send({ error: 'Internal Server Error' });
    }
});
// Auth Hook
fastify.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health')
        return;
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Authorization header missing');
    }
    const token = authHeader.split(' ')[1];
    try {
        const session = (0, shared_auth_1.verifyToken)(token);
        request.userSession = session;
    }
    catch (err) {
        throw new Error('Invalid token');
    }
});
const projects_1 = require("./routes/projects");
const uploads_1 = require("./routes/uploads");
const schema_1 = require("./routes/schema");
const tasks_1 = require("./routes/tasks");
const enrichment_1 = require("./routes/enrichment");
const collisions_1 = require("./routes/collisions");
const exports_1 = require("./routes/exports");
fastify.register(projects_1.projectRoutes);
fastify.register(uploads_1.uploadRoutes);
fastify.register(schema_1.schemaRoutes);
fastify.register(tasks_1.taskRoutes);
fastify.register(enrichment_1.enrichmentRoutes);
fastify.register(collisions_1.collisionsRoutes);
fastify.register(exports_1.exportRoutes);
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', service: 'csv-service-api' };
});
const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=server.js.map