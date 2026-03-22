import fastify from 'fastify';
import { schemaRoutes } from './routes/schema';
import { uploadRoutes } from './routes/uploads';
import { db, uploadJobs, projects, schemaTemplates, schemaFields, organizations, users, eq, and } from '@ecom-kit/shared-db';
import { v4 as uuidv4 } from 'uuid';

async function runTests() {
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

  app.register(schemaRoutes);
  app.register(uploadRoutes);

  await app.ready();

  console.log('--- Phase 5 Integration Tests ---');

  try {
    // -1. Setup: Create Org and User to satisfy FK
    await db.insert(organizations).values({
      id: orgId,
      name: 'Test Org',
      slug: `test-org-${orgId.slice(0, 8)}`
    });

    await db.insert(users).values({
      id: userId,
      email: `test-${userId.slice(0, 8)}@example.com`,
      passwordHash: 'dummy-hash'
    });

    // 0. Setup: Create Project and UploadJob
    await db.insert(projects).values({
      id: projectId,
      orgId,
      name: 'Test Project'
    });

    await db.insert(uploadJobs).values({
      id: uploadId,
      orgId,
      projectId,
      status: 'parsed',
      s3Key: 'test/key.csv',
      originalFilename: 'test.csv'
    });

    // 1. Setup: Create initial schema draft
    await db.insert(schemaTemplates).values({
      id: uuidv4(),
      orgId,
      jobId: uploadId,
      status: 'draft',
      aiModel: 'gpt-3.5-turbo'
    });

    console.log('✓ Setup complete');

    // 2. Test: GET /uploads/:id/schema
    const getRes = await app.inject({
      method: 'GET',
      url: `/uploads/${uploadId}/schema`
    });
    
    if (getRes.statusCode !== 200) throw new Error(`GET /schema failed: ${getRes.payload}`);
    console.log('✓ GET /schema successful');

    // 3. Test: PATCH /uploads/:id/schema
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/uploads/${uploadId}/schema`,
      body: {
        fields: [
          { name: 'color', label: 'Color', fieldType: 'text', isRequired: false },
          { name: 'size', label: 'Size', fieldType: 'enum', isRequired: true, allowedValues: ['S', 'M', 'L'] }
        ]
      }
    });

    if (patchRes.statusCode !== 200) throw new Error(`PATCH /schema failed: ${patchRes.payload}`);
    
    // Verify fields in DB
    const template = await db.query.schemaTemplates.findFirst({
      where: eq(schemaTemplates.jobId, uploadId),
      with: { fields: true }
    }) as any;
    if (template?.fields.length !== 2) throw new Error('Field mismatch after PATCH');
    console.log('✓ PATCH /schema successful');

    // 4. Test: POST /uploads/:id/schema/approve
    const approveRes = await app.inject({
      method: 'POST',
      url: `/uploads/${uploadId}/schema/approve`
    });

    if (approveRes.statusCode !== 200) throw new Error(`POST /approve failed: ${approveRes.payload}`);
    
    // Verify states
    const updatedJob = await db.query.uploadJobs.findFirst({ where: eq(uploadJobs.id, uploadId) });
    if (updatedJob?.status !== 'schema_confirmed') throw new Error(`Job status not confirmed: ${updatedJob?.status}`);
    
    const updatedTemplate = await db.query.schemaTemplates.findFirst({ where: eq(schemaTemplates.jobId, uploadId) });
    if (updatedTemplate?.status !== 'confirmed') throw new Error('Schema status not confirmed');
    
    console.log('✓ POST /approve successful');

    console.log('\nALL TESTS PASSED! 🚀');
    process.exit(0);
  } catch (error) {
    console.error('\nTEST FAILED ❌');
    console.error(error);
    process.exit(1);
  }
}

runTests();
