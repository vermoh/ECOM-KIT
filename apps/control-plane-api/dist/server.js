"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const fastify = (0, fastify_1.default)({
    logger: true
});
// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
    this.log.error(error);
    if (error.statusCode === 401) {
        reply.status(401).send({ error: 'Unauthorized' });
    }
    else if (error.statusCode === 403) {
        reply.status(403).send({ error: 'Forbidden' });
    }
    else {
        reply.status(500).send({ error: 'Internal Server Error' });
    }
});
// Deny-by-default Hook
fastify.addHook('onRequest', async (request, reply) => {
    // Allow health checks unconditionally
    if (request.url === '/health')
        return;
    // Enforce session presence for all other routes
    if (!request.userSession) {
        reply.status(401).send({ error: 'Unauthorized: Session required' });
        return reply;
    }
});
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', service: 'control-plane-api' };
});
fastify.get('/api/v1/protected', async (request, reply) => {
    return { data: 'This is protected data' };
});
const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=server.js.map