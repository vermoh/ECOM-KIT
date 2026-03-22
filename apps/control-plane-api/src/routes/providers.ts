import { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { providerConfigs, auditLogs } from '@ecom-kit/shared-db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requirePermission } from '../guards.js';
import { encrypt, decrypt } from '@ecom-kit/shared-auth';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

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

  // FOR SERVICES: Get decrypted key
  fastify.get('/key/:provider', {
    preHandler: [requirePermission('secret:read')]
  }, async (request, reply) => {
    const session = request.userSession!;
    const { provider } = request.params as any;

    const [config] = await db.select()
      .from(providerConfigs)
      .where(and(
        eq(providerConfigs.orgId, session.orgId),
        eq(providerConfigs.provider, provider)
      ))
      .limit(1);

    if (!config) {
      return reply.status(404).send({ error: 'CONFIG_NOT_FOUND' });
    }

    const decryptedValue = decrypt(config.encryptedValue, MASTER_KEY);

    return {
      provider: config.provider,
      value: decryptedValue
    };
  });
}
