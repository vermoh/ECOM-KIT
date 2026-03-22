import Fastify from 'fastify';
import { verifyToken } from '@ecom-kit/shared-auth';
import { UserSession } from '@ecom-kit/shared-types';

const fastify = Fastify({
  logger: true
});

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSession;
    accessGrant?: any;
  }
}

// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
  this.log.error(error);
  if (error.statusCode === 401 || error.message === 'Invalid token' || error.message === 'Authorization header missing') {
    reply.status(401).send({ error: 'Unauthorized', message: error.message });
  } else if (error.statusCode === 403) {
    reply.status(403).send({ error: 'Forbidden' });
  } else {
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// Auth Hook
fastify.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header missing');
  }

  const token = authHeader.split(' ')[1];
  try {
    const session = verifyToken(token);
    request.userSession = session;
  } catch (err) {
    throw new Error('Invalid token');
  }
});

import { projectRoutes } from './routes/projects';
import { uploadRoutes } from './routes/uploads';
import { schemaRoutes } from './routes/schema';
import { taskRoutes } from './routes/tasks';
import { enrichmentRoutes } from './routes/enrichment';
import { collisionsRoutes } from './routes/collisions';

fastify.register(projectRoutes);
fastify.register(uploadRoutes);
fastify.register(schemaRoutes);
fastify.register(taskRoutes);
fastify.register(enrichmentRoutes);
fastify.register(collisionsRoutes);

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
