import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { db, uploadJobs, schemaTemplates, schemaFields, reviewTasks, enrichmentRuns, enrichedItems, collisions, eq, and, withTenant } from '@ecom-kit/shared-db';
import { s3Client, BUCKET_NAME } from './lib/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { generateSchemaSuggestion, enrichItem } from './lib/ai';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const CSV_PARSING_QUEUE = 'csv-parsing';
export const GENERATE_SCHEMA_QUEUE = 'generate-schema';
export const ENRICHMENT_QUEUE = 'enrichment';

export const generateSchemaQueue = new Queue(GENERATE_SCHEMA_QUEUE, {
  connection: redisConnection as any,
});

interface CSVJobData {
  uploadJobId: string;
  orgId: string;
  s3Key: string;
}

interface EnrichmentJobData {
  enrichmentRunId: string;
  uploadJobId: string;
  orgId: string;
  s3Key: string;
}

export async function processParsingJob(job: Job<CSVJobData>) {
  const { uploadJobId, orgId, s3Key } = job.data;

  console.log(`[Parsing] Processing upload job ${uploadJobId} for org ${orgId}`);

  try {
    await withTenant(orgId, async (tx) => {
      await tx.update(uploadJobs)
        .set({ status: 'parsing', updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
    });

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const response = await s3Client.send(command);
    if (!response.Body) throw new Error('Empty S3 body');

    let rowCount = 0;
    const parser = (response.Body as Readable).pipe(
      parse({ columns: true, skip_empty_lines: true })
    );

    for await (const _ of parser) {
      rowCount++;
    }

    await withTenant(orgId, async (tx) => {
      await tx.update(uploadJobs)
        .set({ status: 'parsed', rowCount, updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
    });

    // Chain Schema Generation
    await generateSchemaQueue.add('generate-schema', { uploadJobId, orgId, s3Key });
    
    console.log(`[Parsing] Job ${uploadJobId} completed. Rows: ${rowCount}`);
  } catch (error: any) {
    console.error(`[Parsing] Job ${uploadJobId} failed:`, error);
    await withTenant(orgId, async (tx) => {
      await tx.update(uploadJobs)
        .set({ status: 'failed', errorDetails: error.message, updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
    });
    throw error;
  }
}

export const parsingWorker = new Worker<CSVJobData>(
  CSV_PARSING_QUEUE,
  processParsingJob,
  { connection: redisConnection as any }
);

export async function processSchemaJob(job: Job<CSVJobData>) {
  const { uploadJobId, orgId, s3Key } = job.data;
  console.log(`[Schema] Generating schema for job ${uploadJobId}`);

  try {
    await withTenant(orgId, async (tx) => {
      await tx.update(uploadJobs)
        .set({ status: 'schema_draft', updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
    });

    // 1. Get sample data from S3
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
    const response = await s3Client.send(command);
    const parser = (response.Body as Readable).pipe(parse({ columns: true, to_line: 5 }));
    
    const sampleRows: any[] = [];
    for await (const row of parser) {
      sampleRows.push(row);
    }
    const headers = Object.keys(sampleRows[0] || {});

    // 2. Mock API Key for now (In real life, fetch from CP)
    const mockApiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';

    // 3. Call AI
    const suggestedFields = await generateSchemaSuggestion(headers, sampleRows, mockApiKey);

    // 4. Save Schema
    await withTenant(orgId, async (tx) => {
      const [template] = await tx.insert(schemaTemplates).values({
        orgId,
        jobId: uploadJobId,
        status: 'draft',
        aiModel: 'gpt-3.5-turbo',
      }).returning();

      for (let i = 0; i < suggestedFields.length; i++) {
        const field = suggestedFields[i];
        await tx.insert(schemaFields).values({
          orgId,
          schemaId: template.id,
          name: field.name,
          label: field.label,
          fieldType: field.field_type as any,
          isRequired: field.is_required || false,
          allowedValues: field.allowed_values,
          description: field.description,
          sortOrder: i,
        });
      }

      // 5. Create Review Task
      await tx.insert(reviewTasks).values({
        orgId,
        jobId: uploadJobId,
        taskType: 'schema_review',
        status: 'pending',
      });
    });

    console.log(`[Schema] Schema draft created for job ${uploadJobId}`);
  } catch (error: any) {
    console.error(`[Schema] Job ${uploadJobId} failed:`, error);
    throw error;
  }
}

export const schemaWorker = new Worker<CSVJobData>(
  GENERATE_SCHEMA_QUEUE,
  processSchemaJob,
  { connection: redisConnection as any }
);

export async function processEnrichmentJob(job: Job<EnrichmentJobData>) {
  const { enrichmentRunId, uploadJobId, orgId, s3Key } = job.data;
  console.log(`[Enrichment] Starting run ${enrichmentRunId} for job ${uploadJobId}`);

  try {
    // 1. Get EnrichmentRun and Confirmed Schema
    const run = await db.query.enrichmentRuns.findFirst({
      where: and(eq(enrichmentRuns.id, enrichmentRunId), eq(enrichmentRuns.orgId, orgId)),
      with: {
        template: {
          with: { fields: true }
        }
      }
    });

    if (!run || !run.template) throw new Error('Enrichment run or template not found');

    await withTenant(orgId, async (tx) => {
      await tx.update(enrichmentRuns)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(enrichmentRuns.id, enrichmentRunId));
      
      await tx.update(uploadJobs)
        .set({ status: 'enriching', updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
    });

    // 2. Download CSV
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
    const response = await s3Client.send(command);
    const parser = (response.Body as Readable).pipe(parse({ columns: true, skip_empty_lines: true }));

    let totalTokens = 0;
    let processedCount = 0;
    let collisionCount = 0;

    const mockApiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';

    // 3. Process rows
    for await (const row of parser) {
      try {
        const { enrichedData, confidence, tokensUsed } = await enrichItem(
          row,
          run.template.fields,
          mockApiKey
        );

        totalTokens += tokensUsed;
        processedCount++;

        // Detect collisions
        const rowCollisions: { field: string; reason: string; value: string | null }[] = [];
        
        // Check confidence
        if (confidence < 80) {
          rowCollisions.push({
            field: '_overall_',
            reason: 'low_confidence',
            value: `Confidence: ${confidence}%`,
          });
        }

        // Check required fields
        for (const field of run.template.fields) {
          if (field.isRequired && (enrichedData[field.name] === null || enrichedData[field.name] === undefined || enrichedData[field.name] === '')) {
            rowCollisions.push({
              field: field.name,
              reason: 'missing_required',
              value: null,
            });
          }
        }

        // Save Enriched Item
        await withTenant(orgId, async (tx) => {
          const [item] = await tx.insert(enrichedItems).values({
            orgId,
            runId: enrichmentRunId,
            skuExternalId: row.sku || row.id || `row-${processedCount}`,
            rawData: JSON.stringify(row),
            enrichedData: JSON.stringify(enrichedData),
            confidence,
            status: rowCollisions.length > 0 ? 'collision' : 'ok',
          }).returning();

          if (rowCollisions.length > 0) {
            collisionCount++;
            for (const collision of rowCollisions) {
              await tx.insert(collisions).values({
                orgId,
                jobId: uploadJobId,
                enrichedItemId: item.id,
                field: collision.field,
                originalValue: collision.value,
                reason: collision.reason,
                status: 'detected',
              });
            }
          }

          // Update Run Stats every 10 items
          if (processedCount % 10 === 0) {
            await tx.update(enrichmentRuns)
              .set({ processedItems: processedCount, tokensUsed: totalTokens })
              .where(eq(enrichmentRuns.id, enrichmentRunId));
          }
        });
      } catch (rowError) {
        console.error(`[Enrichment] Row failed in run ${enrichmentRunId}:`, rowError);
      }
    }

    // 4. Finalize
    await withTenant(orgId, async (tx) => {
      await tx.update(enrichmentRuns)
        .set({ 
          status: 'completed', 
          completedAt: new Date(),
          processedItems: processedCount,
          tokensUsed: totalTokens 
        })
        .where(eq(enrichmentRuns.id, enrichmentRunId));

      const finalStatus = collisionCount > 0 ? 'needs_collision_review' : 'ready';
      await tx.update(uploadJobs)
        .set({ status: finalStatus, updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
      
      if (collisionCount > 0) {
        await tx.insert(reviewTasks).values({
          orgId,
          jobId: uploadJobId,
          taskType: 'collision_review',
          status: 'pending',
        });
      }
    });

    console.log(`[Enrichment] Run ${enrichmentRunId} completed with ${collisionCount} collisions.`);
  } catch (error: any) {
    console.error(`[Enrichment] Run ${enrichmentRunId} failed:`, error);
    await withTenant(orgId, async (tx) => {
      await tx.update(enrichmentRuns)
        .set({ status: 'failed', completedAt: new Date() })
        .where(eq(enrichmentRuns.id, enrichmentRunId));
    });
    throw error;
  }
}

export const enrichmentWorker = new Worker<EnrichmentJobData>(
  ENRICHMENT_QUEUE,
  processEnrichmentJob,
  { connection: redisConnection as any }
);

parsingWorker.on('failed', (job, err) => console.error(`Parsing ${job?.id} failed: ${err.message}`));
schemaWorker.on('failed', (job, err) => console.error(`Schema ${job?.id} failed: ${err.message}`));
enrichmentWorker.on('failed', (job, err) => console.error(`Enrichment ${job?.id} failed: ${err.message}`));
