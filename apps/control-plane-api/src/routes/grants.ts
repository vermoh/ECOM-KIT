import { FastifyInstance } from 'fastify';
import { eq, and, isNull, db } from '@ecom-kit/shared-db';
import { accessGrants, services, serviceAccess, auditLogs } from '@ecom-kit/shared-db';
import { requirePermission } from '../guards.js';
import crypto from 'node:crypto';

const SERVICE_TOKEN = process.env.CSV_SERVICE_TOKEN || 'csv-service-shared-secret';

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

  /**
   * Internal service-to-service endpoint for issuing AccessGrants.
   * Authenticated by shared SERVICE_TOKEN (not JWT) so background workers can call it.
   * The orgId must be passed explicitly in the request body since there is no user session.
   */
  fastify.post('/issue-internal', async (request, reply) => {
    const { serviceSlug, scopes, orgId } = request.body as any;
    const authHeader = (request.headers['authorization'] as string) || '';
    const token = authHeader.replace('Bearer ', '');

    if (token !== SERVICE_TOKEN) {
      return reply.status(401).send({ error: 'INVALID_SERVICE_TOKEN' });
    }

    if (!orgId || !serviceSlug) {
      return reply.status(400).send({ error: 'ORG_ID_AND_SERVICE_SLUG_REQUIRED' });
    }

    // 1. Find service
    const [service] = await db.select().from(services).where(eq(services.slug, serviceSlug)).limit(1);
    if (!service) {
      return reply.status(404).send({ error: 'SERVICE_NOT_FOUND' });
    }

    // 2. Verify the org has access to this service
    const [access] = await db.select().from(serviceAccess).where(and(
      eq(serviceAccess.orgId, orgId),
      eq(serviceAccess.serviceId, service.id),
      eq(serviceAccess.enabled, true)
    )).limit(1);

    if (!access) {
      console.warn(`[Grants] Service access denied for org ${orgId} → ${serviceSlug}`);
      return reply.status(403).send({ error: 'SERVICE_ACCESS_DENIED' });
    }

    // 3. Generate random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 4. Store grant (15 min TTL)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const [grant] = await db.insert(accessGrants).values({
      orgId,
      serviceId: service.id,
      tokenHash,
      scopes: scopes || [],
      expiresAt,
    }).returning();

    console.log(`[Grants] Issued internal grant ${grant.id} for org ${orgId} → ${serviceSlug}`);

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
