import { processEnrichmentJob } from './worker';
import { db, organizations, users, projects, uploadJobs, schemaTemplates, schemaFields, enrichmentRuns, enrichedItems, eq } from '@ecom-kit/shared-db';
import { s3Client } from './lib/s3';
import { Readable } from 'stream';
import crypto from 'node:crypto';

async function runEnrichmentTests() {
  console.log('--- Phase 6 Enrichment Worker Tests ---');

  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const schemaId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  try {
    // 1. Setup DB
    await db.insert(organizations).values({ id: orgId, name: 'Enrichment Test Org', slug: `enrich-org-${orgId.slice(0, 8)}` });
    await db.insert(users).values({ id: userId, email: `enrich-${userId.slice(0, 8)}@example.com`, passwordHash: 'hash' });
    await db.insert(projects).values({ id: projectId, orgId, name: 'Enrichment Project' });
    await db.insert(uploadJobs).values({ 
      id: uploadId, 
      orgId, 
      projectId, 
      status: 'schema_confirmed', 
      s3Key: 'test.csv', 
      originalFilename: 'test.csv',
      rowCount: 1
    });

    await db.insert(schemaTemplates).values({
      id: schemaId,
      orgId,
      jobId: uploadId,
      status: 'confirmed',
      aiModel: 'gpt-3.5-turbo'
    });

    await db.insert(schemaFields).values({
      orgId,
      schemaId,
      name: 'color',
      label: 'Color',
      fieldType: 'text'
    });

    await db.insert(enrichmentRuns).values({
      id: runId,
      orgId,
      jobId: uploadId,
      schemaId,
      status: 'queued',
      totalItems: 1
    });

    // 2. Mock S3
    const originalSend = s3Client.send;
    s3Client.send = (async (command: any) => {
      return {
        Body: Readable.from(['sku,name\nSKU001,Red T-Shirt\n'])
      } as any;
    }) as any;

    // 3. Mock AI (OpenRouter fetch)
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify({ enriched_data: { color: 'Red' }, confidence: 95 }) } }
          ],
          usage: { total_tokens: 50 }
        })
      } as any;
    }) as any;

    // 4. Run Job
    const mockJob = {
      data: { enrichmentRunId: runId, uploadJobId: uploadId, orgId, s3Key: 'test.csv' }
    } as any;

    await processEnrichmentJob(mockJob);

    // 5. Assertions
    const run = await db.query.enrichmentRuns.findFirst({ where: eq(enrichmentRuns.id, runId) });
    if (!run || run.status !== 'completed') throw new Error(`Run status: ${run?.status}`);
    if (run.processedItems !== 1) throw new Error(`Processed items: ${run.processedItems}`);

    const item = await db.query.enrichedItems.findFirst({ where: eq(enrichedItems.runId, runId) });
    if (!item) throw new Error('Enriched item not created');
    
    const enrichedData = JSON.parse(item.enrichedData as string);
    if (enrichedData.color !== 'Red') throw new Error(`Enriched data mismatch: ${item.enrichedData}`);

    const job = await db.query.uploadJobs.findFirst({ where: eq(uploadJobs.id, uploadId) });
    if (job?.status !== 'enriched') throw new Error(`Job status: ${job?.status}`);

    console.log('✓ Enrichment worker test successful');

    // Restore mocks
    s3Client.send = originalSend;
    global.fetch = originalFetch;

    console.log('\nALL ENRICHMENT WORKER TESTS PASSED! 🚀');
    process.exit(0);
  } catch (error) {
    console.error('\nENRICHMENT WORKER TEST FAILED ❌');
    console.error(error);
    process.exit(1);
  }
}

runEnrichmentTests();
