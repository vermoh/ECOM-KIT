import { processSchemaJob } from './worker';
import { db, organizations, users, projects, uploadJobs, schemaTemplates, schemaFields, reviewTasks, eq } from '@ecom-kit/shared-db';
import { s3Client } from './lib/s3';
import * as ai from './lib/ai';
import crypto from 'node:crypto';
import { Readable } from 'stream';

async function runWorkerTests() {
  console.log('--- Phase 5 Worker Tests ---');

  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();

  try {
    // 1. Setup DB
    await db.insert(organizations).values({ id: orgId, name: 'Worker Test Org', slug: `worker-org-${orgId.slice(0, 8)}` });
    await db.insert(users).values({ id: userId, email: `worker-${userId.slice(0, 8)}@example.com`, passwordHash: 'hash' });
    await db.insert(projects).values({ id: projectId, orgId, name: 'Worker Project' });
    await db.insert(uploadJobs).values({ id: uploadId, orgId, projectId, status: 'parsed', s3Key: 'test.csv', originalFilename: 'test.csv' });

    // 2. Mock S3
    const originalSend = s3Client.send;
    s3Client.send = (async (command: any) => {
      return {
        Body: Readable.from(['header1,header2\nvalue1,value2\n'])
      } as any;
    }) as any;

    // 3. Mock AI (OpenRouter fetch)
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify([{ name: 'header1', label: 'Label 1', field_type: 'text', is_required: true, description: 'Desc 1' }]) } }
          ]
        })
      } as any;
    }) as any;

    // 4. Run Job
    const mockJob = {
      data: { uploadJobId: uploadId, orgId, s3Key: 'test.csv' }
    } as any;

    await processSchemaJob(mockJob);

    // 5. Assertions
    const template = await db.query.schemaTemplates.findFirst({ where: eq(schemaTemplates.jobId, uploadId) });
    if (!template) throw new Error('Schema template not created');
    
    const fields = await db.query.schemaFields.findMany({ where: eq(schemaFields.schemaId, template.id) });
    if (fields.length !== 1) throw new Error(`Expected 1 field, got ${fields.length}`);
    if (fields[0].name !== 'header1') throw new Error(`Unexpected field name: ${fields[0].name}`);

    const task = await db.query.reviewTasks.findFirst({ where: eq(reviewTasks.jobId, uploadId) });
    if (!task || task.taskType !== 'schema_review') throw new Error('Review task not created');

    console.log('✓ Worker test successful');

    // Restore mocks
    s3Client.send = originalSend;
    global.fetch = originalFetch;

    console.log('\nALL WORKER TESTS PASSED! 🚀');
    process.exit(0);
  } catch (error) {
    console.error('\nWORKER TEST FAILED ❌');
    console.error(error);
    process.exit(1);
  }
}

runWorkerTests();
