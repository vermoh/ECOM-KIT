import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { db, uploadJobs, schemaTemplates, schemaFields, reviewTasks, enrichmentRuns, enrichedItems, collisions, exportJobs, seoTasks, auditLogs, eq, and, withTenant } from '@ecom-kit/shared-db';
import { s3Client, BUCKET_NAME } from './lib/s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify/sync';
import { Readable } from 'stream';
import { analyseProductCatalog, generateSchemaSuggestion, enrichItem, generateFewShotExamples, generateSeoAttributes, postProcessEnrichedData, detectRowCategory, buildCategoryHint, CatalogAnalysis, analyseFieldConsistency, verifyEnrichedItem } from './lib/ai';
import { checkBudget, consumeBudget } from './lib/budget';
import { loadKnowledge, saveConfirmedKnowledge, formatKnowledgeForPrompt } from './lib/knowledge';
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

const avgConfidenceGauge = new client.Gauge({
  name: 'csv_worker_avg_confidence',
  help: 'Average confidence score of last enrichment run',
});

const failedRatioGauge = new client.Gauge({
  name: 'csv_worker_failed_ratio',
  help: 'Ratio of failed rows in last enrichment run',
});

const itemsFailedCounter = new client.Counter({
  name: 'csv_worker_items_failed_total',
  help: 'Total number of items that failed enrichment',
});

register.registerMetric(jobsProcessedCounter);
register.registerMetric(itemsEnrichedCounter);
register.registerMetric(tokensConsumedCounter);
register.registerMetric(avgConfidenceGauge);
register.registerMetric(failedRatioGauge);
register.registerMetric(itemsFailedCounter);

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
export const NORMALISATION_QUEUE = 'normalisation';
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

export const normalisationQueue = new Queue(NORMALISATION_QUEUE, {
  connection: redisConnection as any,
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

    // 1. Get sample data from S3 — read up to 40 rows to capture product variety
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
    const response = await s3Client.send(command);
    const parser = (response.Body as Readable).pipe(parse({ columns: true, to_line: 40 }));

    const allSampleRows: any[] = [];
    for await (const row of parser) {
      allSampleRows.push(row);
    }
    const headers = Object.keys(allSampleRows[0] || {});

    // Deduplicate by category to maximise variety in the AI prompt (up to 3 rows per category)
    const categoryKey = headers.find(h => /categor|катег|type|тип/i.test(h));
    const seenCategories = new Map<string, number>();
    const sampleRows: any[] = [];
    for (const row of allSampleRows) {
      const cat = categoryKey ? String(row[categoryKey] || '').trim() : '';
      const count = seenCategories.get(cat) || 0;
      if (count < 3) {
        sampleRows.push(row);
        seenCategories.set(cat, count + 1);
      }
    }
    // Always include the last row too (catches tail-end categories)
    if (allSampleRows.length > 0 && !sampleRows.includes(allSampleRows[allSampleRows.length - 1])) {
      sampleRows.push(allSampleRows[allSampleRows.length - 1]);
    }

    const uniqueCategories = [...seenCategories.keys()].filter(Boolean);

    // 2. Security: Fetch API key using AccessGrant
    let apiKey = process.env.OPENROUTER_API_KEY || '';
    if (job.data.accessGrantToken) {
        try {
            apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
            console.log('[Schema] Using secured API key from Control Plane');
        } catch (err) {
            console.error('[Schema] Failed to fetch secured key, falling back to env');
        }
    }
    if (!apiKey) {
        throw new Error('[Schema] No API key available: set OPENROUTER_API_KEY env var or provide a valid AccessGrant token');
    }

    // 2.5 Budget Check
    const hasBudget = await checkBudget(orgId, 10); // Assume 10 tokens for schema
    if (!hasBudget) throw new Error('OUT_OF_BUDGET: Not enough tokens for schema generation');

    // 3. Call AI — two-stage schema generation
    const uploadJobForContext = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, uploadJobId), eq(uploadJobs.orgId, orgId))
    });
    const catalogContext = uploadJobForContext?.catalogContext || undefined;

    // Stage A: Analyse product catalog to identify categories and key attributes (gpt-4o)
    console.log(`[Schema] Stage A: Analysing catalog categories...`);
    const catalogAnalysis = await analyseProductCatalog(sampleRows, apiKey, catalogContext);
    if (catalogAnalysis.totalTokensUsed > 0) {
      await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed: catalogAnalysis.totalTokensUsed, model: 'gpt-4o', purpose: 'catalog_analysis' });
    }
    console.log(`[Schema] Stage A complete: ${catalogAnalysis.categories.length} categories identified`);

    // Stage B: Generate enrichment fields based on analysis (gpt-4o-mini)
    console.log(`[Schema] Stage B: Generating enrichment fields...`);
    const { fields: suggestedFields, tokensUsed: schemaTokens } = await generateSchemaSuggestion(
      headers, sampleRows, uniqueCategories, apiKey, catalogContext, catalogAnalysis
    );

    await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed: schemaTokens || 10, model: 'gpt-4o-mini', purpose: 'schema_generation' });

    // 4. Save Schema
    await withTenant(orgId, async (tx) => {
      const [template] = await tx.insert(schemaTemplates).values({
        orgId,
        jobId: uploadJobId,
        status: 'draft',
        aiModel: catalogAnalysis.categories.length > 0 ? 'gpt-4o + gpt-4o-mini' : 'gpt-4o-mini',
        catalogAnalysis: catalogAnalysis.categories.length > 0 ? JSON.stringify(catalogAnalysis) : null,
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

        // Normalize fieldType — AI may return aliases like "string", "integer", etc.
        let fieldType = String(raw.field_type ?? raw.fieldType ?? raw.type ?? 'text').toLowerCase();
        const VALID_FIELD_TYPES = ['text', 'number', 'boolean', 'enum', 'url'];
        if (!VALID_FIELD_TYPES.includes(fieldType)) {
          if (['string', 'str', 'varchar'].includes(fieldType)) fieldType = 'text';
          else if (['integer', 'int', 'float', 'decimal', 'double'].includes(fieldType)) fieldType = 'number';
          else if (['bool'].includes(fieldType)) fieldType = 'boolean';
          else if (['select', 'dropdown', 'options', 'choice'].includes(fieldType)) fieldType = 'enum';
          else fieldType = 'text';
          console.log(`[Schema] Normalized field type for "${fieldName}": "${raw.field_type ?? raw.fieldType ?? raw.type}" → "${fieldType}"`);
        }

        const label = raw.label ?? raw.display_name ?? raw.displayName ?? fieldName;

        await tx.insert(schemaFields).values({
          orgId,
          schemaId: template.id,
          name: fieldName,
          label: String(label),
          fieldType: fieldType as any,
          // AI-suggested fields are never required by default — user sets this during schema review
          isRequired: false,
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
    const templateFields = run.template.fields;

    // Concurrency guard — abort if another run for this job is already active
    const concurrentRun = await db.query.enrichmentRuns.findFirst({
      where: and(eq(enrichmentRuns.jobId, uploadJobId), eq(enrichmentRuns.status, 'running'))
    });
    if (concurrentRun && concurrentRun.id !== enrichmentRunId) {
      throw new Error(`CONCURRENT_RUN: Another enrichment run ${concurrentRun.id} is already active for job ${uploadJobId}`);
    }

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

    // 2. Security: Fetch API key using AccessGrant
    let apiKey = process.env.OPENROUTER_API_KEY || '';
    if (job.data.accessGrantToken) {
        try {
            apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
            console.log('[Enrichment] Using secured API key from Control Plane');
        } catch (err) {
            console.error('[Enrichment] Failed to fetch secured key, falling back to env');
        }
    }
    if (!apiKey) {
        throw new Error('[Enrichment] No API key available: set OPENROUTER_API_KEY env var or provide a valid AccessGrant token');
    }

    // 2.5 Global Budget Check
    if (!await checkBudget(orgId, 100)) {
        await withTenant(orgId, async (tx) => {
          await tx.update(enrichmentRuns).set({ status: 'paused', completedAt: new Date() }).where(eq(enrichmentRuns.id, enrichmentRunId));
          await tx.update(uploadJobs).set({ status: 'paused', updatedAt: new Date() }).where(eq(uploadJobs.id, uploadJobId));
        });
        throw new Error('OUT_OF_BUDGET: Enrichment paused due to insufficient tokens');
    }

    // 2.6 Catalog context + category analysis + few-shot examples (generated once, reused for all rows)
    const catalogContext = uploadJob.catalogContext || undefined;

    // Load category analysis from schema template (saved during Stage A)
    let knownCategories: CatalogAnalysis['categories'] = [];
    try {
      if (run.template.catalogAnalysis) {
        const analysis: CatalogAnalysis = JSON.parse(run.template.catalogAnalysis);
        knownCategories = analysis.categories || [];
        console.log(`[Enrichment] Loaded ${knownCategories.length} categories from catalog analysis`);
      }
    } catch { /* ignore parse errors */ }

    // Cache: category hint per detected category name to avoid rebuilding
    const categoryHintCache = new Map<string, string>();

    let fewShotExamples = '';
    try {
      // Read a small sample from S3 to generate few-shot examples
      const sampleCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
      const sampleRes = await s3Client.send(sampleCmd);
      const sampleParser = (sampleRes.Body as Readable).pipe(
        parse({ columns: true, to: 8, skip_empty_lines: true, cast: false })
      );
      const sampleRows: any[] = [];
      for await (const row of sampleParser) sampleRows.push(row);
      fewShotExamples = await generateFewShotExamples(sampleRows, templateFields, apiKey, catalogContext);
      if (fewShotExamples) {
        console.log('[Enrichment] Few-shot examples generated successfully');
      }
    } catch (err) {
      console.warn('[Enrichment] Failed to generate few-shot examples, proceeding without:', err);
    }

    // 2.7 Load cross-org knowledge base (corrections + confirmed examples)
    let knowledgeBlock = '';
    try {
      const fieldNames = templateFields.map((f: any) => f.name);
      const knowledge = await loadKnowledge(fieldNames, 20);
      knowledgeBlock = formatKnowledgeForPrompt(knowledge);
      if (knowledge.length > 0) {
        console.log(`[Enrichment] Loaded ${knowledge.length} knowledge entries (${knowledge.filter(k => k.source === 'correction').length} corrections, ${knowledge.filter(k => k.source === 'confirmed').length} confirmed)`);
      }
    } catch (err) {
      console.warn('[Enrichment] Failed to load knowledge base:', err);
    }

    // 3. Stream CSV row-by-row — avoids loading the full file into memory
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
    const response = await s3Client.send(command);
    if (!response.Body) throw new Error('Empty S3 body');

    const parser = (response.Body as Readable).pipe(
      parse({ columns: true, skip_empty_lines: true, cast: false })
    );

    let totalTokens = 0;
    let processedCount = 0;
    let failedCount = 0;
    let collisionCount = 0;
    let rowIndex = 0; // absolute row counter — never skipped, used as stable row ID
    let confidenceSum = 0; // for avg confidence metric

    // Checkpoint/resume: skip rows already processed in a previous attempt
    // Guard against invalid resume values (negative or beyond row count)
    const resumeFromRow = Math.max(0, run.lastProcessedRowIndex || 0);
    if (resumeFromRow > 0) {
      console.log(`[Enrichment] Resuming from row ${resumeFromRow + 1} (checkpoint)`);
    }

    // 3.5 Live examples: accumulate high-confidence results per category (max 3 per category)
    const categoryExamples = new Map<string, { input: any; output: any }[]>();

    const CONCURRENCY = 5;
    const MAX_ROW_RETRIES = 2;

    // Helper: process a single row with retry logic
    async function processRow(row: any, currentRowIndex: number) {
      const rowLabel = row.sku || row.id || row['Имя [Ru]'] || row['name'] || `row-${currentRowIndex}`;

      // Idempotency guard: if this row was already enriched (e.g. crash after batch
      // completed but before checkpoint was saved), skip it to avoid duplicate inserts.
      const existingItem = await db.query.enrichedItems.findFirst({
        where: and(
          eq(enrichedItems.runId, enrichmentRunId),
          eq(enrichedItems.skuExternalId, `row-${currentRowIndex}`),
          eq(enrichedItems.orgId, orgId)
        )
      });
      if (existingItem) {
        console.log(`[Enrichment] Row ${currentRowIndex} already processed (idempotency guard), skipping`);
        processedCount++;
        return;
      }

      // Detect row category and build hint (cached per category name)
      const matchedCat = detectRowCategory(row, knownCategories);
      const catKey = matchedCat?.name || '__default__';
      if (!categoryHintCache.has(catKey)) {
        categoryHintCache.set(catKey, buildCategoryHint(matchedCat));
      }
      const categoryHint = categoryHintCache.get(catKey) || '';
      const liveExamples = categoryExamples.get(catKey) || [];

      // Retry loop
      let lastError: any = null;
      for (let attempt = 0; attempt <= MAX_ROW_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
            console.log(`[Enrichment] Row ${currentRowIndex} retry ${attempt}/${MAX_ROW_RETRIES} after ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
          }

          const { enrichedData: rawEnriched, confidence, tokensUsed, uncertainFields } = await enrichItem(
            row, templateFields, apiKey, catalogContext, fewShotExamples, categoryHint, liveExamples, knowledgeBlock
          );

          totalTokens += tokensUsed;
          processedCount++;
          confidenceSum += confidence;

          await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-4o-mini', purpose: 'enrichment' });
          itemsEnrichedCounter.inc();
          tokensConsumedCounter.inc(tokensUsed);

          const { data: enrichedData, enumViolations } = postProcessEnrichedData(rawEnriched, templateFields);

          // Detect collisions
          const rowCollisions: { field: string; reason: string; value: string | null; suggestedValues?: string[] }[] = [];

          for (const field of templateFields) {
            if (field.isRequired && (enrichedData[field.name] === null || enrichedData[field.name] === undefined || enrichedData[field.name] === '')) {
              rowCollisions.push({ field: field.name, reason: 'missing_required', value: null, suggestedValues: uncertainFields[field.name] });
            }
          }
          for (const v of enumViolations) {
            rowCollisions.push({ field: v.field, reason: 'invalid_enum_value', value: `"${v.value}" not in [${v.allowedValues.join(', ')}]`, suggestedValues: v.allowedValues });
          }
          for (const [fieldName, alternatives] of Object.entries(uncertainFields)) {
            if (rowCollisions.some(c => c.field === fieldName)) continue;
            rowCollisions.push({ field: fieldName, reason: 'low_confidence', value: enrichedData[fieldName] != null ? String(enrichedData[fieldName]) : null, suggestedValues: alternatives });
          }

          await withTenant(orgId, async (tx) => {
            const [item] = await tx.insert(enrichedItems).values({
              orgId, uploadId: uploadJobId, runId: enrichmentRunId,
              skuExternalId: `row-${currentRowIndex}`,
              rawData: JSON.stringify(row),
              enrichedData: JSON.stringify(enrichedData),
              confidence, status: rowCollisions.length > 0 ? 'collision' : 'ok',
            }).returning();

            if (rowCollisions.length > 0) {
              collisionCount++;
              for (const collision of rowCollisions) {
                await tx.insert(collisions).values({
                  orgId, jobId: uploadJobId, enrichedItemId: item.id,
                  field: collision.field, originalValue: collision.value,
                  suggestedValues: collision.suggestedValues?.length ? JSON.stringify(collision.suggestedValues) : null,
                  reason: collision.reason, status: 'detected',
                });
              }
            }
          });

          // Accumulate live examples
          if (rowCollisions.length === 0 && confidence >= 80) {
            const examples = categoryExamples.get(catKey) || [];
            examples.push({ input: row, output: enrichedData });
            if (examples.length > 3) examples.shift();
            categoryExamples.set(catKey, examples);

            if (processedCount % 5 === 0) {
              const productName = row.name || row['Имя [Ru]'] || row['Название'] || row.title || '';
              if (productName) {
                for (const key of ['brand', 'product_type', 'material', 'color']) {
                  if (enrichedData[key] && String(enrichedData[key]).trim()) {
                    saveConfirmedKnowledge(orgId, key, String(productName).slice(0, 200), String(enrichedData[key]), catKey !== '__default__' ? catKey : undefined);
                  }
                }
              }
            }
          }

          return; // success — exit retry loop
        } catch (err) {
          lastError = err;
        }
      }

      // All retries exhausted — save as failed
      failedCount++;
      itemsFailedCounter.inc();
      console.error(`[Enrichment] Row ${currentRowIndex} failed after ${MAX_ROW_RETRIES + 1} attempts:`, lastError?.message || lastError);
      try {
        await withTenant(orgId, async (tx) => {
          await tx.insert(enrichedItems).values({
            orgId, uploadId: uploadJobId, runId: enrichmentRunId,
            skuExternalId: `row-${currentRowIndex}`,
            rawData: JSON.stringify(row),
            enrichedData: JSON.stringify({}),
            confidence: 0, status: 'collision',
          });
        });
      } catch (saveErr) {
        console.error(`[Enrichment] Could not save failed row ${currentRowIndex}:`, saveErr);
      }
    }

    // 4. Process rows with concurrency
    let batch: { row: any; idx: number }[] = [];

    for await (const row of parser) {
      rowIndex++;

      // Checkpoint/resume: skip already-processed rows
      if (rowIndex <= resumeFromRow) continue;

      batch.push({ row, idx: rowIndex });

      if (batch.length >= CONCURRENCY) {
        // NOTE: categoryExamples Map is mutated by concurrent processRow calls within
        // this batch. This is safe because Node.js is single-threaded — Map mutations
        // happen between event loop ticks, so there is no data race. However, rows
        // within the same batch may not see each other's examples (they read stale
        // snapshots at the start of each call). This is acceptable: examples accumulate
        // across batches, improving quality progressively.
        await Promise.all(batch.map(({ row: r, idx }) => processRow(r, idx)));
        batch = [];

        // Save checkpoint every batch
        await withTenant(orgId, async (tx) => {
          await tx.update(enrichmentRuns)
            .set({ processedItems: processedCount, tokensUsed: totalTokens, lastProcessedRowIndex: rowIndex })
            .where(eq(enrichmentRuns.id, enrichmentRunId));
        });
      }
    }

    // Process remaining rows in the last partial batch
    if (batch.length > 0) {
      await Promise.all(batch.map(({ row: r, idx }) => processRow(r, idx)));
    }

    // Update quality metrics
    if (processedCount > 0) {
      avgConfidenceGauge.set(confidenceSum / processedCount);
    }
    if (processedCount + failedCount > 0) {
      failedRatioGauge.set(failedCount / (processedCount + failedCount));
    }

    // 4. Verification pass — re-check low-confidence rows with gpt-4o
    const lowConfidenceItems = await db.query.enrichedItems.findMany({
      where: and(
        eq(enrichedItems.runId, enrichmentRunId),
        eq(enrichedItems.orgId, orgId)
      )
    });
    const candidates = lowConfidenceItems.filter(i => i.confidence !== null && i.confidence < 70 && i.status !== 'collision');
    const maxVerify = Math.floor(processedCount * 0.2); // max 20% of total
    const toVerify = candidates.slice(0, Math.max(maxVerify, 1)); // at least 1 if any exist

    if (toVerify.length > 0 && await checkBudget(orgId, toVerify.length * 50)) {
      console.log(`[Enrichment] Verification pass: ${toVerify.length} low-confidence items (of ${candidates.length} candidates, max ${maxVerify})`);

      for (const item of toVerify) {
        try {
          const rawRow = JSON.parse(item.rawData || '{}');
          const currentData = JSON.parse(typeof item.enrichedData === 'string' ? item.enrichedData : JSON.stringify(item.enrichedData));

          const result = await verifyEnrichedItem(rawRow, currentData, templateFields, apiKey, catalogContext);
          totalTokens += result.tokensUsed;
          await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed: result.tokensUsed, model: 'gpt-4o', purpose: 'verification' });

          if (result.corrections.length > 0 || result.revisedConfidence > (item.confidence || 0)) {
            // Apply corrections
            const updatedData = { ...currentData };
            for (const c of result.corrections) {
              updatedData[c.field] = c.newValue;
              console.log(`[Verification] ${item.skuExternalId} → ${c.field}: "${c.oldValue}" → "${c.newValue}" (${c.reason})`);
            }

            await withTenant(orgId, async (tx) => {
              await tx.update(enrichedItems)
                .set({
                  enrichedData: JSON.stringify(updatedData),
                  confidence: result.revisedConfidence,
                  status: result.revisedConfidence >= 80 ? 'ok' : item.status,
                })
                .where(eq(enrichedItems.id, item.id));

              // If revised confidence >= 80, remove existing low_confidence collisions for this item
              if (result.revisedConfidence >= 80) {
                const itemCollisions = await tx.query.collisions.findMany({
                  where: and(
                    eq(collisions.enrichedItemId, item.id),
                    eq(collisions.reason, 'low_confidence'),
                    eq(collisions.status, 'detected')
                  )
                });
                for (const col of itemCollisions) {
                  await tx.update(collisions)
                    .set({ status: 'resolved', resolvedValue: updatedData[col.field] != null ? JSON.stringify(updatedData[col.field]) : null, resolvedAt: new Date() })
                    .where(eq(collisions.id, col.id));
                  collisionCount = Math.max(0, collisionCount - 1);
                }
              }
            });
          }
        } catch (verifyErr) {
          console.warn(`[Verification] Failed for item ${item.skuExternalId}:`, verifyErr);
        }
      }
      console.log(`[Enrichment] Verification pass complete`);
    }

    // 5. Finalize
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

      // Trigger normalisation pass (runs before SEO, auto-fixes inconsistencies)
      await normalisationQueue.add('normalisation', {
        enrichmentRunId,
        uploadJobId,
        orgId,
      });

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

    console.log(`[Enrichment] Run ${enrichmentRunId} done. Processed: ${processedCount}, Failed: ${failedCount}, Collisions: ${collisionCount}.`);
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

// --- Normalisation ---

interface NormalisationJobData {
  enrichmentRunId: string;
  uploadJobId: string;
  orgId: string;
}

export async function processNormalisationJob(job: Job<NormalisationJobData>) {
  const { enrichmentRunId, uploadJobId, orgId } = job.data;
  console.log(`[Normalisation] Starting for run ${enrichmentRunId}`);

  try {
    // 1. Load enriched items and schema fields
    const run = await db.query.enrichmentRuns.findFirst({
      where: and(eq(enrichmentRuns.id, enrichmentRunId), eq(enrichmentRuns.orgId, orgId)),
      with: { template: { with: { fields: true } } }
    });
    if (!run?.template) {
      console.warn('[Normalisation] Run or template not found, skipping');
      return;
    }

    const items = await db.query.enrichedItems.findMany({
      where: and(eq(enrichedItems.runId, enrichmentRunId), eq(enrichedItems.orgId, orgId))
    });

    if (items.length === 0) {
      console.log('[Normalisation] No items to normalise');
      return;
    }

    // 2. Analyse consistency
    const parsedItems = items.map(item => ({
      id: item.id,
      enrichedData: typeof item.enrichedData === 'string' ? JSON.parse(item.enrichedData) : item.enrichedData,
    }));

    const consistencyResults = analyseFieldConsistency(parsedItems, run.template.fields);
    console.log(`[Normalisation] Found ${consistencyResults.length} fields with inconsistencies`);

    let autoFixCount = 0;
    let collisionCount = 0;

    for (const result of consistencyResults) {
      for (const cluster of result.clusters) {
        if (cluster.variants.length === 0) continue;

        // Auto-fix: if the canonical has 3+ usages and variants are just case/whitespace differences
        const isSimpleCaseDiff = cluster.variants.every(v =>
          v.toLowerCase().replace(/\s+/g, ' ') === cluster.canonical.toLowerCase().replace(/\s+/g, ' ')
        );

        if (isSimpleCaseDiff) {
          // Auto-normalise: update all items in the cluster to the canonical value
          await withTenant(orgId, async (tx) => {
            for (const itemId of cluster.itemIds) {
              const item = items.find(i => i.id === itemId);
              if (!item) continue;
              const data: any = typeof item.enrichedData === 'string' ? JSON.parse(item.enrichedData) : JSON.parse(JSON.stringify(item.enrichedData));
              if (data[result.field] && String(data[result.field]).trim() !== cluster.canonical) {
                data[result.field] = cluster.canonical;
                await tx.update(enrichedItems)
                  .set({ enrichedData: JSON.stringify(data) })
                  .where(eq(enrichedItems.id, itemId));
                autoFixCount++;
              }
            }
          });
        } else {
          // Create collision for manual review
          const affectedItem = items.find(i => cluster.itemIds.includes(i.id));
          if (affectedItem) {
            await withTenant(orgId, async (tx) => {
              await tx.insert(collisions).values({
                orgId,
                jobId: uploadJobId,
                enrichedItemId: affectedItem.id,
                field: result.field,
                originalValue: cluster.variants[0],
                suggestedValues: JSON.stringify([cluster.canonical, ...cluster.variants]),
                reason: 'inconsistent_value',
                status: 'detected',
              });
            });
            collisionCount++;
          }
        }
      }
    }

    console.log(`[Normalisation] Done. Auto-fixed: ${autoFixCount}, New collisions: ${collisionCount}`);

    // If new collisions were created, update job status
    if (collisionCount > 0) {
      const uploadJob = await db.query.uploadJobs.findFirst({
        where: and(eq(uploadJobs.id, uploadJobId), eq(uploadJobs.orgId, orgId))
      });
      if (uploadJob && uploadJob.status !== 'needs_collision_review') {
        await withTenant(orgId, async (tx) => {
          await tx.update(uploadJobs)
            .set({ status: 'needs_collision_review', updatedAt: new Date() })
            .where(eq(uploadJobs.id, uploadJobId));

          // Create review task if there isn't one already pending
          const existingTask = await tx.query.reviewTasks.findFirst({
            where: and(
              eq(reviewTasks.jobId, uploadJobId),
              eq(reviewTasks.taskType, 'collision_review'),
              eq(reviewTasks.status, 'pending')
            )
          });
          if (!existingTask) {
            await tx.insert(reviewTasks).values({
              orgId,
              jobId: uploadJobId,
              taskType: 'collision_review',
              status: 'pending',
            });
          }
        });
      }
    }
  } catch (err) {
    console.error(`[Normalisation] Failed:`, err);
    // Non-fatal — don't throw, pipeline continues
  }
}

export const normalisationWorker = new Worker<NormalisationJobData>(
  NORMALISATION_QUEUE,
  processNormalisationJob,
  { connection: redisConnection as any }
);

// --- SEO Generation ---

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
    let apiKey = process.env.OPENROUTER_API_KEY || '';
    if (job.data.accessGrantToken) {
        try {
            apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
            console.log('[SEO] Using secured API key from Control Plane');
        } catch (err) {
            console.error('[SEO] Failed to fetch secured key, falling back to env');
        }
    }
    if (!apiKey) {
        throw new Error('[SEO] No API key available: set OPENROUTER_API_KEY env var or provide a valid AccessGrant token');
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
        await consumeBudget({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-4o-mini', purpose: 'seo' });
        
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
      with: { fields: { orderBy: (f: any, { asc }: any) => [asc(f.sortOrder)] } }
    });
    if (!schema) throw new Error('Confirmed schema not found');

    // 2. Fetch upload job to get original s3Key for column-order preservation
    const uploadJobRecord = await db.query.uploadJobs.findFirst({
      where: and(eq(uploadJobs.id, uploadId), eq(uploadJobs.orgId, orgId))
    });
    if (!uploadJobRecord) throw new Error('Upload job not found');

    // 3. Read original CSV headers (preserving exact user-defined order)
    // Use `to: 1` (record limit, not line limit) so the header line is consumed
    // correctly and we receive exactly 1 data record to extract column names from.
    const originalS3Resp = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: uploadJobRecord.s3Key })
    );
    if (!originalS3Resp.Body) throw new Error('Original S3 file not found');

    let originalHeaders: string[] = [];
    const headerParser = (originalS3Resp.Body as Readable).pipe(
      parse({ columns: true, to: 1 })
    );
    for await (const firstRow of headerParser) {
      originalHeaders = Object.keys(firstRow);
      break;
    }

    // 4. Fetch all enriched items keyed by stable row ID
    const itemRows = await db.query.enrichedItems.findMany({
      where: eq(enrichedItems.uploadId, uploadId),
      orderBy: (t, { asc }) => [asc(t.createdAt)]
    });
    const itemByRowId = new Map(itemRows.map(i => [i.skuExternalId, i]));

    // 5. Stream original CSV again to get all rows in original order
    const csvS3Resp = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: uploadJobRecord.s3Key })
    );
    if (!csvS3Resp.Body) throw new Error('CSV S3 body missing on second read');

    const schemaFieldNames = schema.fields.map((f: any) => f.name);
    const enrichedOnlyColumns = schemaFieldNames.filter((n: string) => !originalHeaders.includes(n));
    const allColumns = [...originalHeaders, ...enrichedOnlyColumns];
    const headers = [...allColumns, '_enrichment_status'];
    if (includeSeo) headers.push('seo_title', 'seo_description', 'seo_keywords');

    const csvRows: any[] = [];
    let rowIdx = 0;
    const originalParser = (csvS3Resp.Body as Readable).pipe(
      parse({ columns: true, skip_empty_lines: true, cast: false })
    );

    for await (const rawRow of originalParser) {
      rowIdx++;
      const rowId = `row-${rowIdx}`;
      const item = itemByRowId.get(rowId);
      const enriched = item ? JSON.parse(item.enrichedData || '{}') : {};
      const merged = { ...rawRow, ...enriched };

      const outRow: any = {};
      allColumns.forEach((col: string) => {
        outRow[col] = merged[col] ?? '';
      });

      // Enrichment status marker — helps users identify gaps
      if (!item) {
        outRow['_enrichment_status'] = 'not_enriched';
      } else if (item.confidence === 0 && Object.keys(enriched).length === 0) {
        outRow['_enrichment_status'] = 'failed';
      } else if (item.status === 'collision') {
        outRow['_enrichment_status'] = 'needs_review';
      } else {
        outRow['_enrichment_status'] = 'ok';
      }

      if (includeSeo) {
        outRow['seo_title'] = enriched['seo_title'] || '';
        outRow['seo_description'] = enriched['seo_description'] || '';
        outRow['seo_keywords'] = enriched['seo_keywords'] || '';
      }
      csvRows.push(outRow);
    }

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
