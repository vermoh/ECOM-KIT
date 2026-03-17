import { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';

import { accessGrants, services, serviceAccess, auditLogs } from '@ecom-kit/shared-db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requirePermission } from '../guards.js';
import crypto from 'node:crypto';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

export async function grantRoutes(fastify: FastifyInstance) {
  
  // Issue an AccessGrant (service token)
  // This is typically called by a UI component or a service that needs to delegate work
  fastify.post('/issue', {
    preHandler: [requirePermission('enrichment:start')] // Example permission that might need a grant
  }, async (request, reply) => {
    const session = request.userSession!;
    const { serviceSlug, scopes } = request.body as any;

    // 1. Find service
    const [service] = await db.select().from(services).where(eq(services.slug, serviceSlug)).limit(1);
    if (!service) {
      return reply.status(404).send({ error: 'SERVICE_NOT_FOUND' });
    }

    // 2. Verify org has access to this service
    const [access] = await db.select().from(serviceAccess).where(and(
      eq(serviceAccess.orgId, session.orgId),
      eq(serviceAccess.serviceId, service.id),
      eq(serviceAccess.enabled, true)
    )).limit(1);

    if (!access) {
      return reply.status(403).send({ error: 'SERVICE_ACCESS_DENIED' });
    }

    // 3. Generate random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 4. Store grant
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL
    
    const [grant] = await db.insert(accessGrants).values({
      orgId: session.orgId,
      serviceId: service.id,
      tokenHash,
      scopes: scopes || [],
      expiresAt,
    }).returning();

    await db.insert(auditLogs).values({
      orgId: session.orgId,
      userId: session.userId,
      action: 'access_grant.issued',
      resourceType: 'access_grant',
      resourceId: grant.id,
      payload: JSON.stringify({ serviceSlug, scopes }),
    });

    // Return raw token ONLY once
    return {
      token: rawToken,
      expiresAt,
      grantId: grant.id
    };
  });

  // Verify an AccessGrant (called by services to validate tokens)
  fastify.post('/verify', async (request, reply) => {
    const { token } = request.body as any;
    if (!token) {
      return reply.status(400).send({ error: 'TOKEN_REQUIRED' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [grant] = await db.select().from(accessGrants).where(and(
      eq(accessGrants.tokenHash, tokenHash),
      isNull(accessGrants.revokedAt)
    )).limit(1);

    
    // Manual date check because some DBs/drivers might be weird with 'now()'
    if (!grant || grant.expiresAt < new Date() || grant.revokedAt !== null) {
      return reply.status(401).send({ error: 'INVALID_OR_EXPIRED_GRANT' });
    }

    return {
      valid: true,
      orgId: grant.orgId,
      serviceId: grant.serviceId,
      scopes: grant.scopes
    };
  });
}
