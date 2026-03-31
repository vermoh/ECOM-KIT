import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { db, uploadJobs, schemaTemplates, schemaFields, reviewTasks, enrichmentRuns, enrichedItems, collisions, exportJobs, seoTasks, auditLogs, eq, and, withTenant } from '@ecom-kit/shared-db';
import { s3Client, BUCKET_NAME } from './lib/s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify/sync';
import { Readable } from 'stream';
import { generateSchemaSuggestion, enrichItem, generateSeoAttributes } from './lib/ai';
import { checkBudget, consumeBudget } from './lib/budget';
import * as client from 'prom-client';
import http from 'node:http';

// Prometheus setup
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const jobsProcessedCounter = new client.Counter({
  name: 'csv_worker_jobs_processed_total',
  help: 'Total number of jobs processed',
  labelNames: ['type', 'status'],
});

const itemsEnrichedCounter = new client.Counter({
  name: 'csv_worker_items_enriched_total',
  help: 'Total number of items enriched',
});

const tokensConsumedCounter = new client.Counter({
  name: 'csv_worker_tokens_consumed_total',
  help: 'Total AI tokens consumed',
});

register.registerMetric(jobsProcessedCounter);
register.registerMetric(itemsEnrichedCounter);
register.registerMetric(tokensConsumedCounter);

// Metrics server
const metricsServer = http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  } else {
    res.statusCode = 404;
    res.end();
  }
});

const METRICS_PORT = process.env.METRICS_PORT || 9090;
metricsServer.listen(METRICS_PORT, () => {
  console.log(`[Metrics] Worker metrics server listening on port ${METRICS_PORT}`);
});

const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4000';

async function getProviderKey(provider: string, grantToken: string): Promise<string> {
    const res = await fetch(`${CP_URL}/api/v1/providers/key/${provider}`, {
        headers: { 'Authorization': `Bearer ${grantToken}` }
    });
    if (!res.ok) throw new Error(`[Auth] Failed to fetch provider key: ${res.statusText}`);
    const data = await res.json() as { value: string };
    return data.value;
}

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const CSV_PARSING_QUEUE = 'csv-parsing';
export const GENERATE_SCHEMA_QUEUE = 'generate-schema';
export const ENRICHMENT_QUEUE = 'enrichment';
export const EXPORT_QUEUE = 'export';
export const SEO_GENERATION_QUEUE = 'seo-generation';

export const generateSchemaQueue = new Queue(GENERATE_SCHEMA_QUEUE, {
  connection: redisConnection as any,
  // ADR-004: default retry policy for schema generation jobs (AI calls may transiently fail)
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

export const seoGenerationQueue = new Queue(SEO_GENERATION_QUEUE, {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

interface CSVJobData {
  uploadJobId: string;
  orgId: string;
  s3Key: string;
  accessGrantToken?: string;
}

interface EnrichmentJobData {
  enrichmentRunId: string;
  uploadJobId: string;
  orgId: string;
  s3Key: string;
  accessGrantToken?: string;
}

interface SeoJobData {
  seoTaskId: string;
  uploadJobId: string;
  enrichmentRunId: string;
  orgId: string;
  lang: string;
  accessGrantToken?: string;
}

interface ExportJobData {
  exportJobId: string;
  uploadId: string;
  orgId: string;
  includeSeo: boolean;
  accessGrantToken?: string;
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
    await generateSchemaQueue.add('generate-schema', { 
      uploadJobId, 
      orgId, 
      s3Key,
      accessGrantToken: job.data.accessGrantToken 
    });
    
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

    // 2. Security: Fetch API key using AccessGrant
    let apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';
    if (job.data.accessGrantToken) {
        try {
            apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
            console.log('[Schema] Using secured API key from Control Plane');
        } catch (err) {
            console.error('[Schema] Failed to fetch secured key, falling back to env');
        }
    }

    // 2.5 Budget Check
    const hasBudget = await checkBudget(orgId, 10); // Assume 10 tokens for schema
    if (!hasBudget) throw new Error('OUT_OF_BUDGET: Not enough tokens for schema generation');

    // 3. Call AI
    const suggestedFields = await generateSchemaSuggestion(headers, sampleRows, apiKey);
    
    // In real scenario, AI returns tokens used, but here we assume a fix or track it if possible
    await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed: 10, model: 'gpt-3.5-turbo', purpose: 'schema_generation' });

    // 4. Save Schema
    await withTenant(orgId, async (tx) => {
      const [template] = await tx.insert(schemaTemplates).values({
        orgId,
        jobId: uploadJobId,
        status: 'draft',
        aiModel: 'gpt-3.5-turbo',
      }).returning();

      for (let i = 0; i < suggestedFields.length; i++) {
        const raw = suggestedFields[i];

        // Normalize: AI may return different key names (field_name, fieldName, etc.)
        const rawName: string | undefined =
          raw.name ?? raw.field_name ?? raw.fieldName ?? raw.key ?? raw.column;
        const fieldName = rawName
          ? String(rawName).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || null
          : null;

        if (!fieldName) {
          console.warn(`[Schema] Skipping field at index ${i} — missing name:`, raw);
          continue;
        }

        const fieldType = raw.field_type ?? raw.fieldType ?? raw.type ?? 'text';
        const label = raw.label ?? raw.display_name ?? raw.displayName ?? fieldName;

        await tx.insert(schemaFields).values({
          orgId,
          schemaId: template.id,
          name: fieldName,
          label: String(label),
          fieldType: fieldType as any,
          isRequired: raw.is_required ?? raw.isRequired ?? false,
          allowedValues: raw.allowed_values ?? raw.allowedValues ?? [],
          description: raw.description ?? null,
          sortOrder: i,
        });
      }

    // 5. Create Review Task — and set job status to schema_review so pipeline waits
      // Gap 3 fix: UploadJob must pass through SCHEMA_REVIEW state per state_machines.md
      await tx.update(uploadJobs)
        .set({ status: 'schema_review', updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));

      await tx.insert(reviewTasks).values({
        orgId,
        jobId: uploadJobId,
        taskType: 'schema_review',
        status: 'pending',
      });
    });

    console.log(`[Schema] Schema draft created for job ${uploadJobId}, awaiting schema review.`);
  } catch (error: any) {
    console.error(`[Schema] Job ${uploadJobId} failed:`, error);
    try {
      await withTenant(orgId, async (tx) => {
        await tx.update(uploadJobs)
          .set({ status: 'failed', errorDetails: error.message || 'Unknown Schema Generation Error', updatedAt: new Date() })
          .where(eq(uploadJobs.id, uploadJobId));
      });
    } catch (dbErr) {
      console.error('[Schema] Failed to update job status to failed:', dbErr);
    }
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

    const uploadJob = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, uploadJobId), eq(uploadJobs.orgId, orgId))
    });

    if (!uploadJob) throw new Error('Upload job not found');

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
    if (!response.Body) throw new Error('Empty S3 body');

    const csvContent = await (response.Body as any).transformToString();
    console.log(`[Enrichment] CSV Content retrieved: ${csvContent.length} bytes`);

    const parser = parse(csvContent, { columns: true, skip_empty_lines: true });
    
    let totalTokens = 0;
    let processedCount = 0;
    let collisionCount = 0;

    // 2. Security: Fetch API key using AccessGrant
    let apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';
    if (job.data.accessGrantToken) {
        try {
            apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
            console.log('[Enrichment] Using secured API key from Control Plane');
        } catch (err) {
            console.error('[Enrichment] Failed to fetch secured key, falling back to env');
        }
    }

    // 2.5 Global Budget Check (at least some buffer)
    if (!await checkBudget(orgId, 100)) {
        // SaaS Readiness: Transition to PAUSED instead of just failing
        await withTenant(orgId, async (tx) => {
          await tx.update(enrichmentRuns).set({ status: 'paused', completedAt: new Date() }).where(eq(enrichmentRuns.id, enrichmentRunId));
          await tx.update(uploadJobs).set({ status: 'paused', updatedAt: new Date() }).where(eq(uploadJobs.id, uploadJobId));
        });
        throw new Error('OUT_OF_BUDGET: Enrichment paused due to insufficient tokens');
    }

    // 3. Process rows
    for await (const row of parser) {
      console.log(`[Enrichment] Processing row ${processedCount + 1}: ${JSON.stringify(row).slice(0, 50)}`);
      try {
        const { enrichedData, confidence, tokensUsed } = await enrichItem(
          row,
          run.template.fields,
          apiKey
        );

        totalTokens += tokensUsed;
        processedCount++;

        // Budget Consumption
        await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-3.5-turbo', purpose: 'enrichment' });
        
        // Metrics
        itemsEnrichedCounter.inc();
        tokensConsumedCounter.inc(tokensUsed);

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
            uploadId: uploadJobId,
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

      // Determine next status: if SEO is enabled, move to ENRICHED, else READY or NEEDS_COLLISION_REVIEW
      let nextStatus: any = collisionCount > 0 ? 'needs_collision_review' : 'ready';
      
      if (uploadJob.includeSeo) {
        nextStatus = 'enriched'; // Pipeline progresses but waits for SEO before READY
      }

      await tx.update(uploadJobs)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadJobId));
      
      if (collisionCount > 0) {
        await tx.insert(reviewTasks).values({
          orgId,
          jobId: uploadJobId,
          taskType: 'collision_review',
          status: 'pending',
        });
      }

      // Trigger SEO if enabled
      if (uploadJob.includeSeo) {
        const [seoTask] = await tx.insert(seoTasks).values({
          orgId,
          uploadId: uploadJobId,
          runId: enrichmentRunId,
          status: 'queued',
          lang: 'ru', // Default for now
          totalItems: processedCount,
        }).returning();

        await seoGenerationQueue.add('seo-generation', {
          seoTaskId: seoTask.id,
          uploadJobId,
          enrichmentRunId,
          orgId,
          lang: 'ru',
          accessGrantToken: job.data.accessGrantToken
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

export async function processSeoJob(job: Job<SeoJobData>) {
  const { seoTaskId, uploadJobId, enrichmentRunId, orgId, lang } = job.data;
  console.log(`[SEO] Starting task ${seoTaskId} for job ${uploadJobId}`);

  try {
    const task = await db.query.seoTasks.findFirst({
      where: and(eq(seoTasks.id, seoTaskId), eq(seoTasks.orgId, orgId))
    });

    if (!task) throw new Error('SEO task not found');

    await withTenant(orgId, async (tx) => {
      await tx.update(seoTasks)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(seoTasks.id, seoTaskId));
    });

    // 1. Fetch all enriched items for this run
    const items = await db.query.enrichedItems.findMany({
      where: and(eq(enrichedItems.runId, enrichmentRunId), eq(enrichedItems.orgId, orgId))
    });

    let totalTokens = 0;
    let processedCount = 0;

    // Budget check
    if (!await checkBudget(orgId, 100)) {
        // SaaS Readiness: Transition to PAUSED
        await withTenant(orgId, async (tx) => {
          await tx.update(seoTasks).set({ status: 'paused', completedAt: new Date() }).where(eq(seoTasks.id, seoTaskId));
          await tx.update(uploadJobs).set({ status: 'paused', updatedAt: new Date() }).where(eq(uploadJobs.id, uploadJobId));
        });
        throw new Error('OUT_OF_BUDGET: SEO generation paused due to insufficient tokens');
    }

    // 2. Security: Fetch API key using AccessGrant
    let apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';
    if (job.data.accessGrantToken) {
        try {
            apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
            console.log('[SEO] Using secured API key from Control Plane');
        } catch (err) {
            console.error('[SEO] Failed to fetch secured key, falling back to env');
        }
    }

    for (const item of items) {
      try {
        const itemData = JSON.parse(item.enrichedData || '{}');
        const originalData = JSON.parse(item.rawData || '{}');
        const combinedData = { ...originalData, ...itemData };

        const { seoData, tokensUsed } = await generateSeoAttributes(combinedData, lang, apiKey);
        
        totalTokens += tokensUsed;
        processedCount++;

        // Budget Consumption
        await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-3.5-turbo', purpose: 'seo' });
        
        // Metrics
        tokensConsumedCounter.inc(tokensUsed);

        const updatedEnrichedData = { ...itemData, ...seoData };

        await withTenant(orgId, async (tx) => {
          await tx.update(enrichedItems)
            .set({ 
              enrichedData: JSON.stringify(updatedEnrichedData),
              updatedAt: new Date() 
            })
            .where(eq(enrichedItems.id, item.id));
        });

        if (processedCount % 10 === 0) {
          await withTenant(orgId, async (tx) => {
            await tx.update(seoTasks)
              .set({ processedItems: processedCount, tokensUsed: totalTokens })
              .where(eq(seoTasks.id, seoTaskId));
          });
        }
      } catch (itemError) {
        console.error(`[SEO] Item ${item.id} failed in task ${seoTaskId}:`, itemError);
      }
    }

    // 2. Finalize
    await withTenant(orgId, async (tx) => {
      await tx.update(seoTasks)
        .set({ 
          status: 'completed', 
          completedAt: new Date(),
          processedItems: processedCount,
          tokensUsed: totalTokens 
        })
        .where(eq(seoTasks.id, seoTaskId));

      // After SEO, check if job should move to READY or stay in NEEDS_COLLISION_REVIEW
      const uploadJob = await tx.query.uploadJobs.findFirst({
        where: eq(uploadJobs.id, uploadJobId)
      });

      if (uploadJob && uploadJob.status === 'enriched') {
        const collisionsExist = await tx.query.collisions.findFirst({
          where: and(eq(collisions.jobId, uploadJobId), eq(collisions.status, 'detected'))
        });

        const nextStatus = collisionsExist ? 'needs_collision_review' : 'ready';
        await tx.update(uploadJobs)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(uploadJobs.id, uploadJobId));
      }
    });

    console.log(`[SEO] Task ${seoTaskId} completed.`);
  } catch (error: any) {
    console.error(`[SEO] Task ${seoTaskId} failed:`, error);
    await withTenant(orgId, async (tx) => {
      await tx.update(seoTasks)
        .set({ status: 'failed', completedAt: new Date() })
        .where(eq(seoTasks.id, seoTaskId));
    });
    throw error;
  }
}

export const seoWorker = new Worker<SeoJobData>(
  SEO_GENERATION_QUEUE,
  processSeoJob,
  { connection: redisConnection as any }
);

export async function processExportJob(job: Job<ExportJobData>) {
  const { exportJobId, uploadId, orgId, includeSeo } = job.data;
  console.log(`[Export] Starting export ${exportJobId} for upload ${uploadId}`);

  try {
    await withTenant(orgId, async (tx) => {
      await tx.update(exportJobs)
        .set({ status: 'generating' })
        .where(eq(exportJobs.id, exportJobId));
    });

    // 1. Get confirmed schema and fields
    const schema = await db.query.schemaTemplates.findFirst({
      where: and(eq(schemaTemplates.jobId, uploadId), eq(schemaTemplates.status, 'confirmed')),
      with: { fields: true }
    });

    if (!schema) throw new Error('Confirmed schema not found');

    // 2. Fetch all enriched items
    const items = await db.query.enrichedItems.findMany({
      where: eq(enrichedItems.uploadId, uploadId),
      orderBy: (items, { asc }) => [asc(items.createdAt)]
    });

    // 3. Build headers: original CSV columns + schema enriched field names (deduplicated)
    // This ensures original data is always present even when AI enrichment is partial.
    const rawColumnsSet = new Set<string>();
    items.forEach(item => {
      const raw = JSON.parse(item.rawData || '{}');
      Object.keys(raw).forEach(k => rawColumnsSet.add(k));
    });
    const schemaFieldNames = schema.fields.map(f => f.name);
    // Original columns first, then schema-only enriched fields not already present
    const allColumns = [
      ...Array.from(rawColumnsSet),
      ...schemaFieldNames.filter(n => !rawColumnsSet.has(n))
    ];
    const headers = [...allColumns];
    if (includeSeo) {
      headers.push('seo_title', 'seo_description', 'seo_keywords');
    }

    const csvRows = items.map(item => {
      const raw = JSON.parse(item.rawData || '{}');
      const enriched = JSON.parse(item.enrichedData || '{}');
      // Merge: raw data first as fallback, enriched values override raw
      const merged = { ...raw, ...enriched };
      const row: any = {};
      allColumns.forEach(col => {
        row[col] = merged[col] ?? '';
      });
      if (includeSeo) {
        row['seo_title'] = enriched['seo_title'] || '';
        row['seo_description'] = enriched['seo_description'] || '';
        row['seo_keywords'] = enriched['seo_keywords'] || '';
      }
      return row;
    });

    const csvContent = stringify(csvRows, { header: true, columns: headers });

    // 4. Upload to S3
    const s3Key = `${orgId}/exports/${uploadId}/${exportJobId}.csv`;
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: csvContent,
      ContentType: 'text/csv',
    }));

    // 5. Generate Pre-signed URL
    const signedUrl = await getSignedUrl(s3Client, new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    }), { expiresIn: 3600 });

    // 6. Update Job
    await withTenant(orgId, async (tx) => {
      await tx.update(exportJobs)
        .set({ 
          status: 'ready', 
          s3Key, 
          signedUrl, 
          urlExpiresAt: new Date(Date.now() + 3600 * 1000),
          completedAt: new Date() 
        })
        .where(eq(exportJobs.id, exportJobId));

      await tx.update(uploadJobs)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(uploadJobs.id, uploadId));

      await tx.insert(auditLogs).values({
        orgId,
        actorType: 'service',
        action: 'export.completed',
        resourceType: 'upload_job',
        resourceId: uploadId,
        payload: JSON.stringify({ exportJobId, s3Key }),
      });
    });

    console.log(`[Export] Export ${exportJobId} ready.`);
  } catch (error: any) {
    console.error(`[Export] Export ${exportJobId} failed:`, error);
    await withTenant(orgId, async (tx) => {
      await tx.update(exportJobs)
        .set({ status: 'failed', errorMessage: error.message, completedAt: new Date() })
        .where(eq(exportJobs.id, exportJobId));
      
      await tx.update(uploadJobs)
        .set({ status: 'ready', updatedAt: new Date() }) // roll back upload status so they can retry
        .where(eq(uploadJobs.id, uploadId));
    });
    throw error;
  }
}

export const exportWorker = new Worker<ExportJobData>(
  EXPORT_QUEUE,
  processExportJob,
  { connection: redisConnection as any }
);

parsingWorker.on('failed', (job, err) => console.error(`Parsing ${job?.id} failed: ${err.message}`));
schemaWorker.on('failed', (job, err) => console.error(`Schema ${job?.id} failed: ${err.message}`));
enrichmentWorker.on('failed', (job, err) => console.error(`Enrichment ${job?.id} failed: ${err.message}`));
seoWorker.on('failed', (job, err) => console.error(`SEO ${job?.id} failed: ${err.message}`));
exportWorker.on('failed', (job, err) => console.error(`Export ${job?.id} failed: ${err.message}`));
