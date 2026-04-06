import Fastify from 'fastify';
import cors from '@fastify/cors';
import crypto from 'node:crypto';
import { verifyToken } from '@ecom-kit/shared-auth';
import { UserSession } from '@ecom-kit/shared-types';
import metricsPlugin from 'fastify-metrics';

const fastify = Fastify({
  logger: true
});

fastify.register(cors, {
  origin: process.env.WEB_ORIGIN || true,
});
fastify.register(metricsPlugin, { endpoint: '/metrics' });

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSession;
    accessGrant?: any;
    correlationId?: string; // Gap 8: x-correlation-id for cross-service audit tracing
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
  if (request.url === '/health' || request.url === '/metrics') return;

  // Gap 8: Extract correlation_id for cross-service audit tracing (Integration Contract)
  request.correlationId = (request.headers['x-correlation-id'] as string) 
    || crypto.randomUUID();

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
import { exportRoutes } from './routes/exports';
import { itemsRoutes } from './routes/items';

fastify.register(projectRoutes);
fastify.register(uploadRoutes);
fastify.register(schemaRoutes);
fastify.register(taskRoutes);
fastify.register(enrichmentRoutes);
fastify.register(collisionsRoutes);
fastify.register(exportRoutes);
fastify.register(itemsRoutes); // Gap 4: enriched items listing

fastify.get('/health', async (request, reply) => {
  return { status: 'ok', service: 'csv-service-api' };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || Number(process.env.CSV_API_PORT) || 4001;
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
