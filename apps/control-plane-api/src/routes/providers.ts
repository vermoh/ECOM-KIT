import { FastifyInstance } from 'fastify';
import { eq, and, isNull, db } from '@ecom-kit/shared-db';
import { providerConfigs, auditLogs, accessGrants } from '@ecom-kit/shared-db';
import { requirePermission } from '../guards.js';
import { encrypt, decrypt } from '@ecom-kit/shared-auth';
import crypto from 'node:crypto';


// Master key for encryption (should be in env in production)
const MASTER_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';


export async function providerRoutes(fastify: FastifyInstance) {
  
  fastify.get('/', {
    preHandler: [requirePermission('secret:read_hint')]
  }, async (request, reply) => {
    const session = request.userSession!;
    
    // RLS handles org isolation, but we explicitly filter by orgId for safety
    const configs = await db.select({
      id: providerConfigs.id,
      orgId: providerConfigs.orgId,
      provider: providerConfigs.provider,
      keyHint: providerConfigs.keyHint,
      rotatedAt: providerConfigs.rotatedAt,
      createdAt: providerConfigs.createdAt
    })
    .from(providerConfigs)
    .where(eq(providerConfigs.orgId, session.orgId));
    
    return configs;
  });

  fastify.post('/', {
    preHandler: [requirePermission('secret:create')]
  }, async (request, reply) => {
    const session = request.userSession!;
    const { provider, value } = request.body as any;
    
    if (!provider || !value) {
      return reply.status(400).send({ error: 'PROVIDER_AND_VALUE_REQUIRED' });
    }

    const encryptedValue = encrypt(value, MASTER_KEY);
    const keyHint = value.slice(-4);
    
    const [newConfig] = await db.insert(providerConfigs).values({
      orgId: session.orgId,
      provider,
      encryptedValue,
      keyHint,
      createdBy: session.userId,
    }).returning({
      id: providerConfigs.id,
      provider: providerConfigs.provider,
      keyHint: providerConfigs.keyHint
    });

    await db.insert(auditLogs).values({
      orgId: session.orgId,
      userId: session.userId,
      action: 'secret.create',
      resourceType: 'provider_config',
      resourceId: newConfig.id,
      payload: JSON.stringify({ provider, key_hint: keyHint }),
    });

    return newConfig;
  });

  fastify.post('/rotate/:id', {
    preHandler: [requirePermission('secret:rotate')]
  }, async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as any;
    const { value } = request.body as any;

    if (!value) {
      return reply.status(400).send({ error: 'VALUE_REQUIRED' });
    }

    const encryptedValue = encrypt(value, MASTER_KEY);
    const keyHint = value.slice(-4);

    const [updated] = await db.update(providerConfigs)
      .set({ 
        encryptedValue, 
        keyHint, 
        rotatedAt: new Date(),
      })
      .where(and(
        eq(providerConfigs.id, id),
        eq(providerConfigs.orgId, session.orgId)
      ))
      .returning({
        id: providerConfigs.id,
        provider: providerConfigs.provider,
        keyHint: providerConfigs.keyHint
      });

    if (!updated) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    await db.insert(auditLogs).values({
      orgId: session.orgId,
      userId: session.userId,
      action: 'secret.rotate',
      resourceType: 'provider_config',
      resourceId: id,
      payload: JSON.stringify({ key_hint: keyHint }),
    });

    return updated;
  });

  fastify.delete('/:id', {
    preHandler: [requirePermission('secret:delete')]
  }, async (request, reply) => {
    const session = request.userSession!;
    const { id } = request.params as any;

    const [deleted] = await db.delete(providerConfigs)
      .where(and(
        eq(providerConfigs.id, id),
        eq(providerConfigs.orgId, session.orgId)
      ))
      .returning();

    if (!deleted) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    await db.insert(auditLogs).values({
      orgId: session.orgId,
      userId: session.userId,
      action: 'secret.delete',
      resourceType: 'provider_config',
      resourceId: id,
    });

    return reply.status(204).send();
  });

  // FOR SERVICES: Get decrypted key — supports both JWT session (user) and AccessGrant token (worker)
  fastify.get('/key/:provider', async (request, reply) => {
    const { provider } = request.params as any;

    let orgId: string | undefined;

    // 1. Try JWT session first (user-initiated call)
    if (request.userSession?.orgId) {
      if (!request.userSession.permissions?.includes('secret:read') && !request.userSession.permissions?.includes('*')) {
        return reply.status(403).send({ error: 'PERMISSION_DENIED', permission: 'secret:read' });
      }
      orgId = request.userSession.orgId;
    } else {
      // 2. Fallback: try AccessGrant token (service worker call) — direct DB lookup, no HTTP self-call
      const authHeader = (request.headers['authorization'] as string) || '';
      const token = authHeader.replace('Bearer ', '');

      if (!token) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const [grant] = await db.select()
          .from(accessGrants)
          .where(and(
            eq(accessGrants.tokenHash, tokenHash),
            isNull(accessGrants.revokedAt)
          ))
          .limit(1);

        if (!grant || grant.expiresAt < new Date()) {
          return reply.status(401).send({ error: 'INVALID_OR_EXPIRED_GRANT' });
        }

        if (!Array.isArray(grant.scopes) || !grant.scopes.includes('secret:read')) {
          return reply.status(403).send({ error: 'PERMISSION_DENIED', permission: 'secret:read' });
        }

        orgId = grant.orgId;
      } catch (err) {
        console.error('[Providers] AccessGrant DB verify failed:', err);
        return reply.status(500).send({ error: 'GRANT_VERIFY_FAILED' });
      }
    }


    if (!orgId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const [config] = await db.select()
      .from(providerConfigs)
      .where(and(
        eq(providerConfigs.orgId, orgId),
        eq(providerConfigs.provider, provider)
      ))
      .limit(1);

    if (!config) {
      return reply.status(404).send({ error: 'CONFIG_NOT_FOUND' });
    }

    const decryptedValue = decrypt(config.encryptedValue, MASTER_KEY);

    console.log(`[Providers] Key resolved for org ${orgId}, provider ${provider}, hint: ***${config.keyHint}`);

    return {
      provider: config.provider,
      value: decryptedValue
    };
  });
}
