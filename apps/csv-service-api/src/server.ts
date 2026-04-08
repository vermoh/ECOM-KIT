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

// Human-readable error message mapping
const USER_FRIENDLY_ERRORS: Record<string, { status: number; message: string; action: string }> = {
  'PERMISSION_DENIED': { status: 403, message: 'You do not have permission for this action.', action: 'Contact your organization admin to request access.' },
  'SCHEMA_NOT_EDITABLE': { status: 400, message: 'This schema can no longer be edited.', action: 'The schema has already been confirmed. Create a new upload to start over.' },
  'CONCURRENT_RUN': { status: 409, message: 'Another enrichment process is already running for this file.', action: 'Wait for the current process to finish or cancel it first.' },
  'AI_API_ERROR': { status: 502, message: 'The AI service returned an error.', action: 'Try again in a few moments. If the problem persists, check your API provider settings.' },
  'AI_PARSE_ERROR': { status: 502, message: 'The AI returned an unexpected response.', action: 'Try again. If it keeps failing, the AI model may need different settings.' },
  'OUT_OF_BUDGET': { status: 402, message: 'Your organization has run out of AI tokens.', action: 'Contact your billing admin to increase the token budget.' },
};

// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
  this.log.error(error);

  if (error.statusCode === 401 || error.message === 'Invalid token' || error.message === 'Authorization header missing') {
    reply.status(401).send({ error: 'Unauthorized', message: 'Please log in again.', action: 'Your session has expired or is invalid.' });
  } else if (error.statusCode === 403) {
    reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission for this action.', action: 'Contact your organization admin to request access.' });
  } else {
    // Check for known error codes in the message
    const errorMsg = error.message || '';
    for (const [code, friendly] of Object.entries(USER_FRIENDLY_ERRORS)) {
      if (errorMsg.includes(code)) {
        reply.status(friendly.status).send({ error: code, message: friendly.message, action: friendly.action });
        return;
      }
    }

    // Check for status-related errors (state machine)
    const statusMatch = errorMsg.match(/Job status must be (\w+) \(current: (\w+)\)/);
    if (statusMatch) {
      const [, required, current] = statusMatch;
      const STATUS_LABELS: Record<string, string> = {
        schema_confirmed: 'confirmed schema', schema_review: 'schema review', enriching: 'enrichment in progress',
        enriched: 'enrichment complete', needs_collision_review: 'collision review needed', ready: 'ready for export',
      };
      reply.status(400).send({
        error: 'INVALID_STATE',
        message: `This action requires the file to be in "${STATUS_LABELS[required] || required}" state, but it is currently in "${STATUS_LABELS[current] || current}".`,
        action: `Complete the "${STATUS_LABELS[current] || current}" step first before proceeding.`,
      });
      return;
    }

    reply.status(500).send({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' });
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

import { db, languages, eq } from '@ecom-kit/shared-db';
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

fastify.get('/languages', async (request, reply) => {
  const langs = await db.query.languages.findMany({
    where: eq(languages.isActive, true),
    orderBy: (l, { asc }) => [asc(l.code)],
  });
  return langs;
});

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
