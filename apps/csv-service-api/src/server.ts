import Fastify from 'fastify';

const fastify = Fastify({
  logger: true
});

// Mock Authentication (JWT or AccessGrant)
declare module 'fastify' {
  interface FastifyRequest {
    accessGrant?: any; // Replace with AccessGrant or UserSession later
  }
}

// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
  this.log.error(error);
  if (error.statusCode === 401) {
    reply.status(401).send({ error: 'Unauthorized' });
  } else if (error.statusCode === 403) {
    reply.status(403).send({ error: 'Forbidden' });
  } else {
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// Deny-by-default Hook (Checks for integration contract)
fastify.addHook('onRequest', async (request, reply) => {
  // Allow health checks
  if (request.url === '/health') return;

  // Enforce token/grant validation for all other routes
  if (!request.accessGrant && !(request as any).userSession) {
    reply.status(401).send({ error: 'Unauthorized: AccessGrant or Session required' });
    return reply;
  }
});

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', service: 'csv-service-api' };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
