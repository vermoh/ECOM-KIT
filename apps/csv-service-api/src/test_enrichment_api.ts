import fastify from 'fastify';
import { enrichmentRoutes } from './routes/enrichment';
import { db, uploadJobs, projects, schemaTemplates, organizations, users, eq } from '@ecom-kit/shared-db';
import { v4 as uuidv4 } from 'uuid';
import { UserSession } from '@ecom-kit/shared-types';

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: UserSession;
  }
}

async function runApiTests() {
  const app = fastify();
  
  const orgId = uuidv4();
  const userId = uuidv4();
  const projectId = uuidv4();
  const uploadId = uuidv4();

  // Mock Auth Middleware
  app.addHook('onRequest', async (request, reply) => {
    request.userSession = {
      userId,
      orgId,
      roles: ['admin'],
      permissions: ['*'],
      exp: Math.floor(Date.now() / 1000) + 3600
    };
  });

  app.register(enrichmentRoutes);

  await app.ready();

  console.log('--- Phase 6 Enrichment API Tests ---');

  try {
    // 1. Setup DB
    await db.insert(organizations).values({ id: orgId, name: 'API Test Org', slug: `api-org-${orgId.slice(0, 8)}` });
    await db.insert(users).values({ id: userId, email: `api-${userId.slice(0, 8)}@example.com`, passwordHash: 'hash' });
    await db.insert(projects).values({ id: projectId, orgId, name: 'API Project' });
    await db.insert(uploadJobs).values({ 
      id: uploadId, 
      orgId, 
      projectId, 
      status: 'schema_confirmed', 
      s3Key: 'test.csv', 
      originalFilename: 'test.csv' 
    });

    await db.insert(schemaTemplates).values({
      id: uuidv4(),
      orgId,
      jobId: uploadId,
      status: 'confirmed',
      aiModel: 'gpt-3.5-turbo'
    });

    console.log('✓ Setup complete');

    // 2. Test: POST /uploads/:id/enrichment/start
    const res = await app.inject({
      method: 'POST',
      url: `/uploads/${uploadId}/enrichment/start`
    });

    if (res.statusCode !== 200) throw new Error(`POST /enrichment/start failed: ${res.payload}`);
    const payload = JSON.parse(res.payload);
    if (!payload.enrichmentRunId) throw new Error('enrichmentRunId missing in response');

    // 3. Verify Job status
    const updatedJob = await db.query.uploadJobs.findFirst({ where: eq(uploadJobs.id, uploadId) });
    if (updatedJob?.status !== 'enriching') throw new Error(`Job status mismatch: ${updatedJob?.status}`);

    console.log('✓ API POST /enrichment/start successful');

    console.log('\nALL API TESTS PASSED! 🚀');
    process.exit(0);
  } catch (error) {
    console.error('\nAPI TEST FAILED ❌');
    console.error(error);
    process.exit(1);
  }
}

runApiTests();
