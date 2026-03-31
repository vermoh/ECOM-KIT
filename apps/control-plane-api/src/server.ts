import Fastify from 'fastify';
import { verifyToken } from '@ecom-kit/shared-auth';
import { UserSession } from '@ecom-kit/shared-types';
import fastifyRedis from '@fastify/redis';
import cors from '@fastify/cors';
import metricsPlugin from 'fastify-metrics';
import { authRoutes } from './routes/auth.js';

const fastify = Fastify({
  logger: true
});

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSession;
  }
}

// CORS — allow web app origin
fastify.register(cors, {
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  credentials: true,
});

// Global Error Handler
fastify.setErrorHandler(function (error, request, reply) {
  this.log.error(error);
  if (error.statusCode === 401) {
    reply.status(401).send({ error: 'Unauthorized', message: error.message });
  } else if (error.statusCode === 403) {
    reply.status(403).send({ error: 'Forbidden' });
  } else {
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

import { checkOrgStatus, checkTemporalAccess } from './guards.js';

import { accessGrants, db, eq, and, isNull } from '@ecom-kit/shared-db';
import crypto from 'node:crypto';

// Auth Guard Hook
fastify.addHook('onRequest', async (request, reply) => {
  // Allow health checks and auth routes unconditionally
  if (request.url === '/health' || request.url.startsWith('/api/v1/auth') || request.url === '/api/v1/grants/verify') return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized: No token provided' });
    return reply;
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Try JWT (User Session)
    if (token.includes('.') && token.split('.').length === 3) {
      const session = verifyToken(token);
      request.userSession = session;
      
      // Additional checks for User Session
      await checkOrgStatus(request, reply);
      if (reply.sent) return;
      await checkTemporalAccess(request, reply);
      if (reply.sent) return;
      return;
    }

    // 2. Try AccessGrant (Service Token)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [grant] = await db.select().from(accessGrants).where(and(
      eq(accessGrants.tokenHash, tokenHash),
      isNull(accessGrants.revokedAt)
    )).limit(1);

    if (grant && grant.expiresAt > new Date()) {
      request.userSession = {
        userId: `service:${grant.serviceId}`,
        orgId: grant.orgId,
        roles: [],
        permissions: grant.scopes,
        exp: Math.floor(grant.expiresAt.getTime() / 1000)
      };
      return;
    }

    throw new Error('Invalid or expired token');
  } catch (err: any) {
    reply.status(401).send({ error: 'Unauthorized: Invalid token', details: err.message });
    return reply;
  }
});

// Redis Registration
fastify.register(fastifyRedis, {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
});

fastify.register(metricsPlugin, { endpoint: '/metrics' });

import { organizationRoutes } from './routes/organizations.js';
import { membershipRoutes } from './routes/memberships.js';
import { providerRoutes } from './routes/providers.js';
import { serviceRoutes } from './routes/services.js';
import { grantRoutes } from './routes/grants.js';
import { billingRoutes } from './routes/billing.js';

// Routes
fastify.register(authRoutes, { prefix: '/api/v1/auth' });
fastify.register(organizationRoutes, { prefix: '/api/v1/organizations' });
fastify.register(membershipRoutes, { prefix: '/api/v1/memberships' });
fastify.register(providerRoutes, { prefix: '/api/v1/providers' });
fastify.register(serviceRoutes, { prefix: '/api/v1/services' });
fastify.register(grantRoutes, { prefix: '/api/v1/grants' });
fastify.register(billingRoutes, { prefix: '/api/v1/billing' });


fastify.get('/health', async (request, reply) => {
  return { status: 'ok', service: 'control-plane-api' };
});

fastify.get('/api/v1/protected', async (request, reply) => {
  return { data: 'This is protected data', session: request.userSession };
});

const start = async () => {
  try {
    await fastify.listen({ port: parseInt(process.env.PORT || '4000'), host: '0.0.0.0' });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
