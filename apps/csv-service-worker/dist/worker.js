"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportWorker = exports.seoWorker = exports.normalisationWorker = exports.enrichmentWorker = exports.schemaWorker = exports.parsingWorker = exports.seoGenerationQueue = exports.normalisationQueue = exports.generateSchemaQueue = exports.SEO_GENERATION_QUEUE = exports.EXPORT_QUEUE = exports.NORMALISATION_QUEUE = exports.ENRICHMENT_QUEUE = exports.GENERATE_SCHEMA_QUEUE = exports.CSV_PARSING_QUEUE = void 0;
exports.processParsingJob = processParsingJob;
exports.processSchemaJob = processSchemaJob;
exports.processEnrichmentJob = processEnrichmentJob;
exports.processNormalisationJob = processNormalisationJob;
exports.processSeoJob = processSeoJob;
exports.processExportJob = processExportJob;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const shared_db_1 = require("@ecom-kit/shared-db");
const s3_1 = require("./lib/s3");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const csv_parse_1 = require("csv-parse");
const sync_1 = require("csv-stringify/sync");
const ai_1 = require("./lib/ai");
const budget_1 = require("./lib/budget");
const knowledge_1 = require("./lib/knowledge");
const client = __importStar(require("prom-client"));
const node_http_1 = __importDefault(require("node:http"));
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
const metricsServer = node_http_1.default.createServer(async (req, res) => {
    if (req.url === '/metrics') {
        res.setHeader('Content-Type', register.contentType);
        res.end(await register.metrics());
    }
    else {
        res.statusCode = 404;
        res.end();
    }
});
const METRICS_PORT = process.env.METRICS_PORT || 9090;
metricsServer.listen(METRICS_PORT, () => {
    console.log(`[Metrics] Worker metrics server listening on port ${METRICS_PORT}`);
});
const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4000';
async function getProviderKey(provider, grantToken) {
    const res = await fetch(`${CP_URL}/api/v1/providers/key/${provider}`, {
        headers: { 'Authorization': `Bearer ${grantToken}` }
    });
    if (!res.ok)
        throw new Error(`[Auth] Failed to fetch provider key: ${res.statusText}`);
    const data = await res.json();
    return data.value;
}
const redisConnection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});
exports.CSV_PARSING_QUEUE = 'csv-parsing';
exports.GENERATE_SCHEMA_QUEUE = 'generate-schema';
exports.ENRICHMENT_QUEUE = 'enrichment';
exports.NORMALISATION_QUEUE = 'normalisation';
exports.EXPORT_QUEUE = 'export';
exports.SEO_GENERATION_QUEUE = 'seo-generation';
exports.generateSchemaQueue = new bullmq_1.Queue(exports.GENERATE_SCHEMA_QUEUE, {
    connection: redisConnection,
    // ADR-004: default retry policy for schema generation jobs (AI calls may transiently fail)
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
    },
});
exports.normalisationQueue = new bullmq_1.Queue(exports.NORMALISATION_QUEUE, {
    connection: redisConnection,
});
exports.seoGenerationQueue = new bullmq_1.Queue(exports.SEO_GENERATION_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
    },
});
async function processParsingJob(job) {
    const { uploadJobId, orgId, s3Key } = job.data;
    console.log(`[Parsing] Processing upload job ${uploadJobId} for org ${orgId}`);
    try {
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'parsing', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
        });
        const command = new client_s3_1.GetObjectCommand({
            Bucket: s3_1.BUCKET_NAME,
            Key: s3Key,
        });
        const response = await s3_1.s3Client.send(command);
        if (!response.Body)
            throw new Error('Empty S3 body');
        let rowCount = 0;
        const parser = response.Body.pipe((0, csv_parse_1.parse)({ columns: true, skip_empty_lines: true }));
        for await (const _ of parser) {
            rowCount++;
        }
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'parsed', rowCount, updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
        });
        // Chain Schema Generation
        await exports.generateSchemaQueue.add('generate-schema', {
            uploadJobId,
            orgId,
            s3Key,
            accessGrantToken: job.data.accessGrantToken
        });
        console.log(`[Parsing] Job ${uploadJobId} completed. Rows: ${rowCount}`);
    }
    catch (error) {
        console.error(`[Parsing] Job ${uploadJobId} failed:`, error);
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'failed', errorDetails: error.message, updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
        });
        throw error;
    }
}
exports.parsingWorker = new bullmq_1.Worker(exports.CSV_PARSING_QUEUE, processParsingJob, { connection: redisConnection });
async function processSchemaJob(job) {
    const { uploadJobId, orgId, s3Key } = job.data;
    console.log(`[Schema] Generating schema for job ${uploadJobId}`);
    try {
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'schema_draft', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
        });
        // 1. Get sample data from S3 — read up to 40 rows to capture product variety
        const command = new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: s3Key });
        const response = await s3_1.s3Client.send(command);
        const parser = response.Body.pipe((0, csv_parse_1.parse)({ columns: true, to_line: 40 }));
        const allSampleRows = [];
        for await (const row of parser) {
            allSampleRows.push(row);
        }
        const headers = Object.keys(allSampleRows[0] || {});
        // Deduplicate by category to maximise variety in the AI prompt (up to 3 rows per category)
        const categoryKey = headers.find(h => /categor|катег|type|тип/i.test(h));
        const seenCategories = new Map();
        const sampleRows = [];
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
            }
            catch (err) {
                console.error('[Schema] Failed to fetch secured key, falling back to env');
            }
        }
        if (!apiKey) {
            throw new Error('[Schema] No API key available: set OPENROUTER_API_KEY env var or provide a valid AccessGrant token');
        }
        // 2.5 Budget Check
        const hasBudget = await (0, budget_1.checkBudget)(orgId, 10); // Assume 10 tokens for schema
        if (!hasBudget)
            throw new Error('OUT_OF_BUDGET: Not enough tokens for schema generation');
        // 3. Call AI — two-stage schema generation
        const uploadJobForContext = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, orgId))
        });
        const catalogContext = uploadJobForContext?.catalogContext || undefined;
        // Stage A: Analyse product catalog to identify categories and key attributes (gpt-4o)
        console.log(`[Schema] Stage A: Analysing catalog categories...`);
        const catalogAnalysis = await (0, ai_1.analyseProductCatalog)(sampleRows, apiKey, catalogContext);
        if (catalogAnalysis.totalTokensUsed > 0) {
            await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed: catalogAnalysis.totalTokensUsed, model: 'gpt-4o', purpose: 'catalog_analysis' });
        }
        console.log(`[Schema] Stage A complete: ${catalogAnalysis.categories.length} categories identified`);
        // Stage B: Generate enrichment fields based on analysis (gpt-4o-mini)
        console.log(`[Schema] Stage B: Generating enrichment fields...`);
        const { fields: suggestedFields, tokensUsed: schemaTokens } = await (0, ai_1.generateSchemaSuggestion)(headers, sampleRows, uniqueCategories, apiKey, catalogContext, catalogAnalysis);
        await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed: schemaTokens || 10, model: 'gpt-4o-mini', purpose: 'schema_generation' });
        // 4. Save Schema
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            const [template] = await tx.insert(shared_db_1.schemaTemplates).values({
                orgId,
                jobId: uploadJobId,
                status: 'draft',
                aiModel: catalogAnalysis.categories.length > 0 ? 'gpt-4o + gpt-4o-mini' : 'gpt-4o-mini',
                catalogAnalysis: catalogAnalysis.categories.length > 0 ? JSON.stringify(catalogAnalysis) : null,
            }).returning();
            for (let i = 0; i < suggestedFields.length; i++) {
                const raw = suggestedFields[i];
                // Normalize: AI may return different key names (field_name, fieldName, etc.)
                const rawName = raw.name ?? raw.field_name ?? raw.fieldName ?? raw.key ?? raw.column;
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
                    if (['string', 'str', 'varchar'].includes(fieldType))
                        fieldType = 'text';
                    else if (['integer', 'int', 'float', 'decimal', 'double'].includes(fieldType))
                        fieldType = 'number';
                    else if (['bool'].includes(fieldType))
                        fieldType = 'boolean';
                    else if (['select', 'dropdown', 'options', 'choice'].includes(fieldType))
                        fieldType = 'enum';
                    else
                        fieldType = 'text';
                    console.log(`[Schema] Normalized field type for "${fieldName}": "${raw.field_type ?? raw.fieldType ?? raw.type}" → "${fieldType}"`);
                }
                const label = raw.label ?? raw.display_name ?? raw.displayName ?? fieldName;
                await tx.insert(shared_db_1.schemaFields).values({
                    orgId,
                    schemaId: template.id,
                    name: fieldName,
                    label: String(label),
                    fieldType: fieldType,
                    // AI-suggested fields are never required by default — user sets this during schema review
                    isRequired: false,
                    allowedValues: raw.allowed_values ?? raw.allowedValues ?? [],
                    description: raw.description ?? null,
                    sortOrder: i,
                });
            }
            // 5. Create Review Task — and set job status to schema_review so pipeline waits
            // Gap 3 fix: UploadJob must pass through SCHEMA_REVIEW state per state_machines.md
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'schema_review', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            await tx.insert(shared_db_1.reviewTasks).values({
                orgId,
                jobId: uploadJobId,
                taskType: 'schema_review',
                status: 'pending',
            });
        });
        console.log(`[Schema] Schema draft created for job ${uploadJobId}, awaiting schema review.`);
    }
    catch (error) {
        console.error(`[Schema] Job ${uploadJobId} failed:`, error);
        try {
            await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                await tx.update(shared_db_1.uploadJobs)
                    .set({ status: 'failed', errorDetails: error.message || 'Unknown Schema Generation Error', updatedAt: new Date() })
                    .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            });
        }
        catch (dbErr) {
            console.error('[Schema] Failed to update job status to failed:', dbErr);
        }
        throw error;
    }
}
exports.schemaWorker = new bullmq_1.Worker(exports.GENERATE_SCHEMA_QUEUE, processSchemaJob, { connection: redisConnection });
async function processEnrichmentJob(job) {
    const { enrichmentRunId, uploadJobId, orgId, s3Key } = job.data;
    console.log(`[Enrichment] Starting run ${enrichmentRunId} for job ${uploadJobId}`);
    try {
        // 1. Get EnrichmentRun and Confirmed Schema
        const run = await shared_db_1.db.query.enrichmentRuns.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.orgId, orgId)),
            with: {
                template: {
                    with: { fields: true }
                }
            }
        });
        if (!run || !run.template)
            throw new Error('Enrichment run or template not found');
        const templateFields = run.template.fields;
        // Concurrency guard — abort if another run for this job is already active
        const concurrentRun = await shared_db_1.db.query.enrichmentRuns.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.jobId, uploadJobId), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.status, 'running'))
        });
        if (concurrentRun && concurrentRun.id !== enrichmentRunId) {
            throw new Error(`CONCURRENT_RUN: Another enrichment run ${concurrentRun.id} is already active for job ${uploadJobId}`);
        }
        const uploadJob = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, orgId))
        });
        if (!uploadJob)
            throw new Error('Upload job not found');
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.enrichmentRuns)
                .set({ status: 'running', startedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'enriching', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
        });
        // 2. Security: Fetch API key using AccessGrant
        let apiKey = process.env.OPENROUTER_API_KEY || '';
        if (job.data.accessGrantToken) {
            try {
                apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
                console.log('[Enrichment] Using secured API key from Control Plane');
            }
            catch (err) {
                console.error('[Enrichment] Failed to fetch secured key, falling back to env');
            }
        }
        if (!apiKey) {
            throw new Error('[Enrichment] No API key available: set OPENROUTER_API_KEY env var or provide a valid AccessGrant token');
        }
        // 2.5 Global Budget Check
        if (!await (0, budget_1.checkBudget)(orgId, 100)) {
            await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                await tx.update(shared_db_1.enrichmentRuns).set({ status: 'paused', completedAt: new Date() }).where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
                await tx.update(shared_db_1.uploadJobs).set({ status: 'paused', updatedAt: new Date() }).where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            });
            throw new Error('OUT_OF_BUDGET: Enrichment paused due to insufficient tokens');
        }
        // 2.6 Catalog context + category analysis + few-shot examples (generated once, reused for all rows)
        const catalogContext = uploadJob.catalogContext || undefined;
        // Load category analysis from schema template (saved during Stage A)
        let knownCategories = [];
        try {
            if (run.template.catalogAnalysis) {
                const analysis = JSON.parse(run.template.catalogAnalysis);
                knownCategories = analysis.categories || [];
                console.log(`[Enrichment] Loaded ${knownCategories.length} categories from catalog analysis`);
            }
        }
        catch { /* ignore parse errors */ }
        // Cache: category hint per detected category name to avoid rebuilding
        const categoryHintCache = new Map();
        let fewShotExamples = '';
        try {
            // Read a small sample from S3 to generate few-shot examples
            const sampleCmd = new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: s3Key });
            const sampleRes = await s3_1.s3Client.send(sampleCmd);
            const sampleParser = sampleRes.Body.pipe((0, csv_parse_1.parse)({ columns: true, to: 8, skip_empty_lines: true, cast: false }));
            const sampleRows = [];
            for await (const row of sampleParser)
                sampleRows.push(row);
            fewShotExamples = await (0, ai_1.generateFewShotExamples)(sampleRows, templateFields, apiKey, catalogContext);
            if (fewShotExamples) {
                console.log('[Enrichment] Few-shot examples generated successfully');
            }
        }
        catch (err) {
            console.warn('[Enrichment] Failed to generate few-shot examples, proceeding without:', err);
        }
        // 2.65 Load golden samples (user-provided reference examples)
        let goldenSamplesBlock = '';
        try {
            if (run.template.goldenSamples) {
                const samples = JSON.parse(run.template.goldenSamples);
                if (Array.isArray(samples) && samples.length > 0) {
                    const lines = samples.map((s, i) => {
                        const entries = Object.entries(s)
                            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
                            .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
                            .join('\n');
                        return `  --- Golden Example ${i + 1} ---\n${entries}`;
                    }).join('\n\n');
                    goldenSamplesBlock = `\nUSER-PROVIDED REFERENCE EXAMPLES (highest priority — match this style and these values exactly):\n${lines}\n`;
                    console.log(`[Enrichment] Loaded ${samples.length} golden samples`);
                }
            }
        }
        catch (err) {
            console.warn('[Enrichment] Failed to parse golden samples:', err);
        }
        if (goldenSamplesBlock) {
            fewShotExamples = goldenSamplesBlock + (fewShotExamples ? '\n' + fewShotExamples : '');
        }
        // 2.7 Load cross-org knowledge base (corrections + confirmed examples)
        let knowledgeBlock = '';
        try {
            const fieldNames = templateFields.map((f) => f.name);
            const knowledge = await (0, knowledge_1.loadKnowledge)(fieldNames, 20);
            knowledgeBlock = (0, knowledge_1.formatKnowledgeForPrompt)(knowledge);
            if (knowledge.length > 0) {
                console.log(`[Enrichment] Loaded ${knowledge.length} knowledge entries (${knowledge.filter(k => k.source === 'correction').length} corrections, ${knowledge.filter(k => k.source === 'confirmed').length} confirmed)`);
            }
        }
        catch (err) {
            console.warn('[Enrichment] Failed to load knowledge base:', err);
        }
        // 3. Stream CSV row-by-row — avoids loading the full file into memory
        const command = new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: s3Key });
        const response = await s3_1.s3Client.send(command);
        if (!response.Body)
            throw new Error('Empty S3 body');
        const parser = response.Body.pipe((0, csv_parse_1.parse)({ columns: true, skip_empty_lines: true, cast: false }));
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
        const categoryExamples = new Map();
        const CONCURRENCY = 5;
        const MAX_ROW_RETRIES = 2;
        // Helper: process a single row with retry logic
        async function processRow(row, currentRowIndex) {
            const rowLabel = row.sku || row.id || row['Имя [Ru]'] || row['name'] || `row-${currentRowIndex}`;
            // Idempotency guard: if this row was already enriched (e.g. crash after batch
            // completed but before checkpoint was saved), skip it to avoid duplicate inserts.
            const existingItem = await shared_db_1.db.query.enrichedItems.findFirst({
                where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichedItems.runId, enrichmentRunId), (0, shared_db_1.eq)(shared_db_1.enrichedItems.skuExternalId, `row-${currentRowIndex}`), (0, shared_db_1.eq)(shared_db_1.enrichedItems.orgId, orgId))
            });
            if (existingItem) {
                console.log(`[Enrichment] Row ${currentRowIndex} already processed (idempotency guard), skipping`);
                processedCount++;
                return;
            }
            // Detect row category and build hint (cached per category name)
            const matchedCat = (0, ai_1.detectRowCategory)(row, knownCategories);
            const catKey = matchedCat?.name || '__default__';
            if (!categoryHintCache.has(catKey)) {
                categoryHintCache.set(catKey, (0, ai_1.buildCategoryHint)(matchedCat));
            }
            const categoryHint = categoryHintCache.get(catKey) || '';
            const liveExamples = categoryExamples.get(catKey) || [];
            // Retry loop
            let lastError = null;
            for (let attempt = 0; attempt <= MAX_ROW_RETRIES; attempt++) {
                try {
                    if (attempt > 0) {
                        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
                        console.log(`[Enrichment] Row ${currentRowIndex} retry ${attempt}/${MAX_ROW_RETRIES} after ${delay}ms`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                    const { enrichedData: rawEnriched, confidence, tokensUsed, uncertainFields } = await (0, ai_1.enrichItem)(row, templateFields, apiKey, catalogContext, fewShotExamples, categoryHint, liveExamples, knowledgeBlock);
                    totalTokens += tokensUsed;
                    processedCount++;
                    confidenceSum += confidence;
                    await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-4o-mini', purpose: 'enrichment' });
                    itemsEnrichedCounter.inc();
                    tokensConsumedCounter.inc(tokensUsed);
                    const { data: enrichedData, enumViolations } = (0, ai_1.postProcessEnrichedData)(rawEnriched, templateFields);
                    // Detect collisions
                    const rowCollisions = [];
                    for (const field of templateFields) {
                        if (field.isRequired && (enrichedData[field.name] === null || enrichedData[field.name] === undefined || enrichedData[field.name] === '')) {
                            rowCollisions.push({ field: field.name, reason: 'missing_required', value: null, suggestedValues: uncertainFields[field.name] });
                        }
                    }
                    for (const v of enumViolations) {
                        rowCollisions.push({ field: v.field, reason: 'invalid_enum_value', value: `"${v.value}" not in [${v.allowedValues.join(', ')}]`, suggestedValues: v.allowedValues });
                    }
                    for (const [fieldName, alternatives] of Object.entries(uncertainFields)) {
                        if (rowCollisions.some(c => c.field === fieldName))
                            continue;
                        rowCollisions.push({ field: fieldName, reason: 'low_confidence', value: enrichedData[fieldName] != null ? String(enrichedData[fieldName]) : null, suggestedValues: alternatives });
                    }
                    await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                        const [item] = await tx.insert(shared_db_1.enrichedItems).values({
                            orgId, uploadId: uploadJobId, runId: enrichmentRunId,
                            skuExternalId: `row-${currentRowIndex}`,
                            rawData: JSON.stringify(row),
                            enrichedData: JSON.stringify(enrichedData),
                            confidence, status: rowCollisions.length > 0 ? 'collision' : 'ok',
                        }).returning();
                        if (rowCollisions.length > 0) {
                            collisionCount++;
                            for (const collision of rowCollisions) {
                                await tx.insert(shared_db_1.collisions).values({
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
                        if (examples.length > 3)
                            examples.shift();
                        categoryExamples.set(catKey, examples);
                        if (processedCount % 5 === 0) {
                            const productName = row.name || row['Имя [Ru]'] || row['Название'] || row.title || '';
                            if (productName) {
                                for (const key of ['brand', 'product_type', 'material', 'color']) {
                                    if (enrichedData[key] && String(enrichedData[key]).trim()) {
                                        (0, knowledge_1.saveConfirmedKnowledge)(orgId, key, String(productName).slice(0, 200), String(enrichedData[key]), catKey !== '__default__' ? catKey : undefined);
                                    }
                                }
                            }
                        }
                    }
                    return; // success — exit retry loop
                }
                catch (err) {
                    lastError = err;
                }
            }
            // All retries exhausted — save as failed
            failedCount++;
            itemsFailedCounter.inc();
            console.error(`[Enrichment] Row ${currentRowIndex} failed after ${MAX_ROW_RETRIES + 1} attempts:`, lastError?.message || lastError);
            try {
                await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                    await tx.insert(shared_db_1.enrichedItems).values({
                        orgId, uploadId: uploadJobId, runId: enrichmentRunId,
                        skuExternalId: `row-${currentRowIndex}`,
                        rawData: JSON.stringify(row),
                        enrichedData: JSON.stringify({}),
                        confidence: 0, status: 'collision',
                    });
                });
            }
            catch (saveErr) {
                console.error(`[Enrichment] Could not save failed row ${currentRowIndex}:`, saveErr);
            }
        }
        // 4. Process rows with concurrency
        let batch = [];
        for await (const row of parser) {
            rowIndex++;
            // Checkpoint/resume: skip already-processed rows
            if (rowIndex <= resumeFromRow)
                continue;
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
                await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                    await tx.update(shared_db_1.enrichmentRuns)
                        .set({ processedItems: processedCount, tokensUsed: totalTokens, lastProcessedRowIndex: rowIndex })
                        .where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
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
        const lowConfidenceItems = await shared_db_1.db.query.enrichedItems.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichedItems.runId, enrichmentRunId), (0, shared_db_1.eq)(shared_db_1.enrichedItems.orgId, orgId))
        });
        const candidates = lowConfidenceItems.filter(i => i.confidence !== null && i.confidence < 70 && i.status !== 'collision');
        const maxVerify = Math.floor(processedCount * 0.2); // max 20% of total
        const toVerify = candidates.slice(0, Math.max(maxVerify, 1)); // at least 1 if any exist
        if (toVerify.length > 0 && await (0, budget_1.checkBudget)(orgId, toVerify.length * 50)) {
            console.log(`[Enrichment] Verification pass: ${toVerify.length} low-confidence items (of ${candidates.length} candidates, max ${maxVerify})`);
            for (const item of toVerify) {
                try {
                    const rawRow = JSON.parse(item.rawData || '{}');
                    const currentData = JSON.parse(typeof item.enrichedData === 'string' ? item.enrichedData : JSON.stringify(item.enrichedData));
                    const result = await (0, ai_1.verifyEnrichedItem)(rawRow, currentData, templateFields, apiKey, catalogContext);
                    totalTokens += result.tokensUsed;
                    await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed: result.tokensUsed, model: 'gpt-4o', purpose: 'verification' });
                    if (result.corrections.length > 0 || result.revisedConfidence > (item.confidence || 0)) {
                        // Apply corrections
                        const updatedData = { ...currentData };
                        for (const c of result.corrections) {
                            updatedData[c.field] = c.newValue;
                            console.log(`[Verification] ${item.skuExternalId} → ${c.field}: "${c.oldValue}" → "${c.newValue}" (${c.reason})`);
                        }
                        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                            await tx.update(shared_db_1.enrichedItems)
                                .set({
                                enrichedData: JSON.stringify(updatedData),
                                confidence: result.revisedConfidence,
                                status: result.revisedConfidence >= 80 ? 'ok' : item.status,
                            })
                                .where((0, shared_db_1.eq)(shared_db_1.enrichedItems.id, item.id));
                            // If revised confidence >= 80, remove existing low_confidence collisions for this item
                            if (result.revisedConfidence >= 80) {
                                const itemCollisions = await tx.query.collisions.findMany({
                                    where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.enrichedItemId, item.id), (0, shared_db_1.eq)(shared_db_1.collisions.reason, 'low_confidence'), (0, shared_db_1.eq)(shared_db_1.collisions.status, 'detected'))
                                });
                                for (const col of itemCollisions) {
                                    await tx.update(shared_db_1.collisions)
                                        .set({ status: 'resolved', resolvedValue: updatedData[col.field] != null ? JSON.stringify(updatedData[col.field]) : null, resolvedAt: new Date() })
                                        .where((0, shared_db_1.eq)(shared_db_1.collisions.id, col.id));
                                    collisionCount = Math.max(0, collisionCount - 1);
                                }
                            }
                        });
                    }
                }
                catch (verifyErr) {
                    console.warn(`[Verification] Failed for item ${item.skuExternalId}:`, verifyErr);
                }
            }
            console.log(`[Enrichment] Verification pass complete`);
        }
        // 5. Finalize
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.enrichmentRuns)
                .set({
                status: 'completed',
                completedAt: new Date(),
                processedItems: processedCount,
                tokensUsed: totalTokens
            })
                .where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
            // Determine next status: if SEO is enabled, move to ENRICHED, else READY or NEEDS_COLLISION_REVIEW
            let nextStatus = collisionCount > 0 ? 'needs_collision_review' : 'ready';
            if (uploadJob.includeSeo) {
                nextStatus = 'enriched'; // Pipeline progresses but waits for SEO before READY
            }
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: nextStatus, updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            if (collisionCount > 0) {
                await tx.insert(shared_db_1.reviewTasks).values({
                    orgId,
                    jobId: uploadJobId,
                    taskType: 'collision_review',
                    status: 'pending',
                });
            }
            // Trigger normalisation pass (runs before SEO, auto-fixes inconsistencies)
            await exports.normalisationQueue.add('normalisation', {
                enrichmentRunId,
                uploadJobId,
                orgId,
            });
            // Trigger SEO if enabled
            if (uploadJob.includeSeo) {
                const [seoTask] = await tx.insert(shared_db_1.seoTasks).values({
                    orgId,
                    uploadId: uploadJobId,
                    runId: enrichmentRunId,
                    status: 'queued',
                    lang: 'ru', // Default for now
                    totalItems: processedCount,
                }).returning();
                await exports.seoGenerationQueue.add('seo-generation', {
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
    }
    catch (error) {
        console.error(`[Enrichment] Run ${enrichmentRunId} failed:`, error);
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.enrichmentRuns)
                .set({ status: 'failed', completedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
        });
        throw error;
    }
}
exports.enrichmentWorker = new bullmq_1.Worker(exports.ENRICHMENT_QUEUE, processEnrichmentJob, { connection: redisConnection });
async function processNormalisationJob(job) {
    const { enrichmentRunId, uploadJobId, orgId } = job.data;
    console.log(`[Normalisation] Starting for run ${enrichmentRunId}`);
    try {
        // 1. Load enriched items and schema fields
        const run = await shared_db_1.db.query.enrichmentRuns.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId), (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.orgId, orgId)),
            with: { template: { with: { fields: true } } }
        });
        if (!run?.template) {
            console.warn('[Normalisation] Run or template not found, skipping');
            return;
        }
        const items = await shared_db_1.db.query.enrichedItems.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichedItems.runId, enrichmentRunId), (0, shared_db_1.eq)(shared_db_1.enrichedItems.orgId, orgId))
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
        const consistencyResults = (0, ai_1.analyseFieldConsistency)(parsedItems, run.template.fields);
        console.log(`[Normalisation] Found ${consistencyResults.length} fields with inconsistencies`);
        let autoFixCount = 0;
        let collisionCount = 0;
        for (const result of consistencyResults) {
            for (const cluster of result.clusters) {
                if (cluster.variants.length === 0)
                    continue;
                // Auto-fix: if the canonical has 3+ usages and variants are just case/whitespace differences
                const isSimpleCaseDiff = cluster.variants.every(v => v.toLowerCase().replace(/\s+/g, ' ') === cluster.canonical.toLowerCase().replace(/\s+/g, ' '));
                if (isSimpleCaseDiff) {
                    // Auto-normalise: update all items in the cluster to the canonical value
                    await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                        for (const itemId of cluster.itemIds) {
                            const item = items.find(i => i.id === itemId);
                            if (!item)
                                continue;
                            const data = typeof item.enrichedData === 'string' ? JSON.parse(item.enrichedData) : JSON.parse(JSON.stringify(item.enrichedData));
                            if (data[result.field] && String(data[result.field]).trim() !== cluster.canonical) {
                                data[result.field] = cluster.canonical;
                                await tx.update(shared_db_1.enrichedItems)
                                    .set({ enrichedData: JSON.stringify(data) })
                                    .where((0, shared_db_1.eq)(shared_db_1.enrichedItems.id, itemId));
                                autoFixCount++;
                            }
                        }
                    });
                }
                else {
                    // Create collision for manual review
                    const affectedItem = items.find(i => cluster.itemIds.includes(i.id));
                    if (affectedItem) {
                        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                            await tx.insert(shared_db_1.collisions).values({
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
            const uploadJob = await shared_db_1.db.query.uploadJobs.findFirst({
                where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, orgId))
            });
            if (uploadJob && uploadJob.status !== 'needs_collision_review') {
                await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                    await tx.update(shared_db_1.uploadJobs)
                        .set({ status: 'needs_collision_review', updatedAt: new Date() })
                        .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
                    // Create review task if there isn't one already pending
                    const existingTask = await tx.query.reviewTasks.findFirst({
                        where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, uploadJobId), (0, shared_db_1.eq)(shared_db_1.reviewTasks.taskType, 'collision_review'), (0, shared_db_1.eq)(shared_db_1.reviewTasks.status, 'pending'))
                    });
                    if (!existingTask) {
                        await tx.insert(shared_db_1.reviewTasks).values({
                            orgId,
                            jobId: uploadJobId,
                            taskType: 'collision_review',
                            status: 'pending',
                        });
                    }
                });
            }
        }
    }
    catch (err) {
        console.error(`[Normalisation] Failed:`, err);
        // Non-fatal — don't throw, pipeline continues
    }
}
exports.normalisationWorker = new bullmq_1.Worker(exports.NORMALISATION_QUEUE, processNormalisationJob, { connection: redisConnection });
// --- SEO Generation ---
async function processSeoJob(job) {
    const { seoTaskId, uploadJobId, enrichmentRunId, orgId, lang } = job.data;
    console.log(`[SEO] Starting task ${seoTaskId} for job ${uploadJobId}`);
    try {
        const task = await shared_db_1.db.query.seoTasks.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.seoTasks.id, seoTaskId), (0, shared_db_1.eq)(shared_db_1.seoTasks.orgId, orgId))
        });
        if (!task)
            throw new Error('SEO task not found');
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.seoTasks)
                .set({ status: 'running', startedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.seoTasks.id, seoTaskId));
        });
        // 1. Fetch all enriched items for this run
        const items = await shared_db_1.db.query.enrichedItems.findMany({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.enrichedItems.runId, enrichmentRunId), (0, shared_db_1.eq)(shared_db_1.enrichedItems.orgId, orgId))
        });
        let totalTokens = 0;
        let processedCount = 0;
        // Budget check
        if (!await (0, budget_1.checkBudget)(orgId, 100)) {
            // SaaS Readiness: Transition to PAUSED
            await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                await tx.update(shared_db_1.seoTasks).set({ status: 'paused', completedAt: new Date() }).where((0, shared_db_1.eq)(shared_db_1.seoTasks.id, seoTaskId));
                await tx.update(shared_db_1.uploadJobs).set({ status: 'paused', updatedAt: new Date() }).where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            });
            throw new Error('OUT_OF_BUDGET: SEO generation paused due to insufficient tokens');
        }
        // 2. Security: Fetch API key using AccessGrant
        let apiKey = process.env.OPENROUTER_API_KEY || '';
        if (job.data.accessGrantToken) {
            try {
                apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
                console.log('[SEO] Using secured API key from Control Plane');
            }
            catch (err) {
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
                const { seoData, tokensUsed } = await (0, ai_1.generateSeoAttributes)(combinedData, lang, apiKey);
                totalTokens += tokensUsed;
                processedCount++;
                // Budget Consumption
                await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-4o-mini', purpose: 'seo' });
                // Metrics
                tokensConsumedCounter.inc(tokensUsed);
                const updatedEnrichedData = { ...itemData, ...seoData };
                await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                    await tx.update(shared_db_1.enrichedItems)
                        .set({
                        enrichedData: JSON.stringify(updatedEnrichedData),
                        updatedAt: new Date()
                    })
                        .where((0, shared_db_1.eq)(shared_db_1.enrichedItems.id, item.id));
                });
                if (processedCount % 10 === 0) {
                    await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                        await tx.update(shared_db_1.seoTasks)
                            .set({ processedItems: processedCount, tokensUsed: totalTokens })
                            .where((0, shared_db_1.eq)(shared_db_1.seoTasks.id, seoTaskId));
                    });
                }
            }
            catch (itemError) {
                console.error(`[SEO] Item ${item.id} failed in task ${seoTaskId}:`, itemError);
            }
        }
        // 2. Finalize
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.seoTasks)
                .set({
                status: 'completed',
                completedAt: new Date(),
                processedItems: processedCount,
                tokensUsed: totalTokens
            })
                .where((0, shared_db_1.eq)(shared_db_1.seoTasks.id, seoTaskId));
            // After SEO, check if job should move to READY or stay in NEEDS_COLLISION_REVIEW
            const uploadJob = await tx.query.uploadJobs.findFirst({
                where: (0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId)
            });
            if (uploadJob && uploadJob.status === 'enriched') {
                const collisionsExist = await tx.query.collisions.findFirst({
                    where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.collisions.jobId, uploadJobId), (0, shared_db_1.eq)(shared_db_1.collisions.status, 'detected'))
                });
                const nextStatus = collisionsExist ? 'needs_collision_review' : 'ready';
                await tx.update(shared_db_1.uploadJobs)
                    .set({ status: nextStatus, updatedAt: new Date() })
                    .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            }
        });
        console.log(`[SEO] Task ${seoTaskId} completed.`);
    }
    catch (error) {
        console.error(`[SEO] Task ${seoTaskId} failed:`, error);
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.seoTasks)
                .set({ status: 'failed', completedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.seoTasks.id, seoTaskId));
        });
        throw error;
    }
}
exports.seoWorker = new bullmq_1.Worker(exports.SEO_GENERATION_QUEUE, processSeoJob, { connection: redisConnection });
async function processExportJob(job) {
    const { exportJobId, uploadId, orgId, includeSeo } = job.data;
    console.log(`[Export] Starting export ${exportJobId} for upload ${uploadId}`);
    try {
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.exportJobs)
                .set({ status: 'generating' })
                .where((0, shared_db_1.eq)(shared_db_1.exportJobs.id, exportJobId));
        });
        // 1. Get confirmed schema and fields
        const schema = await shared_db_1.db.query.schemaTemplates.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, uploadId), (0, shared_db_1.eq)(shared_db_1.schemaTemplates.status, 'confirmed')),
            with: { fields: { orderBy: (f, { asc }) => [asc(f.sortOrder)] } }
        });
        if (!schema)
            throw new Error('Confirmed schema not found');
        // 2. Fetch upload job to get original s3Key for column-order preservation
        const uploadJobRecord = await shared_db_1.db.query.uploadJobs.findFirst({
            where: (0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId), (0, shared_db_1.eq)(shared_db_1.uploadJobs.orgId, orgId))
        });
        if (!uploadJobRecord)
            throw new Error('Upload job not found');
        // 3. Read original CSV headers (preserving exact user-defined order)
        // Use `to: 1` (record limit, not line limit) so the header line is consumed
        // correctly and we receive exactly 1 data record to extract column names from.
        const originalS3Resp = await s3_1.s3Client.send(new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: uploadJobRecord.s3Key }));
        if (!originalS3Resp.Body)
            throw new Error('Original S3 file not found');
        let originalHeaders = [];
        const headerParser = originalS3Resp.Body.pipe((0, csv_parse_1.parse)({ columns: true, to: 1 }));
        for await (const firstRow of headerParser) {
            originalHeaders = Object.keys(firstRow);
            break;
        }
        // 4. Fetch all enriched items keyed by stable row ID
        const itemRows = await shared_db_1.db.query.enrichedItems.findMany({
            where: (0, shared_db_1.eq)(shared_db_1.enrichedItems.uploadId, uploadId),
            orderBy: (t, { asc }) => [asc(t.createdAt)]
        });
        const itemByRowId = new Map(itemRows.map(i => [i.skuExternalId, i]));
        // 5. Stream original CSV again to get all rows in original order
        const csvS3Resp = await s3_1.s3Client.send(new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: uploadJobRecord.s3Key }));
        if (!csvS3Resp.Body)
            throw new Error('CSV S3 body missing on second read');
        const schemaFieldNames = schema.fields.map((f) => f.name);
        const enrichedOnlyColumns = schemaFieldNames.filter((n) => !originalHeaders.includes(n));
        const allColumns = [...originalHeaders, ...enrichedOnlyColumns];
        const headers = [...allColumns, '_enrichment_status'];
        if (includeSeo)
            headers.push('seo_title', 'seo_description', 'seo_keywords');
        const csvRows = [];
        let rowIdx = 0;
        const originalParser = csvS3Resp.Body.pipe((0, csv_parse_1.parse)({ columns: true, skip_empty_lines: true, cast: false }));
        for await (const rawRow of originalParser) {
            rowIdx++;
            const rowId = `row-${rowIdx}`;
            const item = itemByRowId.get(rowId);
            const enriched = item ? JSON.parse(item.enrichedData || '{}') : {};
            const merged = { ...rawRow, ...enriched };
            const outRow = {};
            allColumns.forEach((col) => {
                outRow[col] = merged[col] ?? '';
            });
            // Enrichment status marker — helps users identify gaps
            if (!item) {
                outRow['_enrichment_status'] = 'not_enriched';
            }
            else if (item.confidence === 0 && Object.keys(enriched).length === 0) {
                outRow['_enrichment_status'] = 'failed';
            }
            else if (item.status === 'collision') {
                outRow['_enrichment_status'] = 'needs_review';
            }
            else {
                outRow['_enrichment_status'] = 'ok';
            }
            if (includeSeo) {
                outRow['seo_title'] = enriched['seo_title'] || '';
                outRow['seo_description'] = enriched['seo_description'] || '';
                outRow['seo_keywords'] = enriched['seo_keywords'] || '';
            }
            csvRows.push(outRow);
        }
        const csvContent = (0, sync_1.stringify)(csvRows, { header: true, columns: headers });
        // 4. Upload to S3
        const s3Key = `${orgId}/exports/${uploadId}/${exportJobId}.csv`;
        await s3_1.s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: s3_1.BUCKET_NAME,
            Key: s3Key,
            Body: csvContent,
            ContentType: 'text/csv',
        }));
        // 5. Generate Pre-signed URL
        const signedUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3_1.s3Client, new client_s3_1.GetObjectCommand({
            Bucket: s3_1.BUCKET_NAME,
            Key: s3Key,
        }), { expiresIn: 3600 });
        // 6. Update Job
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.exportJobs)
                .set({
                status: 'ready',
                s3Key,
                signedUrl,
                urlExpiresAt: new Date(Date.now() + 3600 * 1000),
                completedAt: new Date()
            })
                .where((0, shared_db_1.eq)(shared_db_1.exportJobs.id, exportJobId));
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'done', updatedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId));
            await tx.insert(shared_db_1.auditLogs).values({
                orgId,
                actorType: 'service',
                action: 'export.completed',
                resourceType: 'upload_job',
                resourceId: uploadId,
                payload: JSON.stringify({ exportJobId, s3Key }),
            });
        });
        console.log(`[Export] Export ${exportJobId} ready.`);
    }
    catch (error) {
        console.error(`[Export] Export ${exportJobId} failed:`, error);
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            await tx.update(shared_db_1.exportJobs)
                .set({ status: 'failed', errorMessage: error.message, completedAt: new Date() })
                .where((0, shared_db_1.eq)(shared_db_1.exportJobs.id, exportJobId));
            await tx.update(shared_db_1.uploadJobs)
                .set({ status: 'ready', updatedAt: new Date() }) // roll back upload status so they can retry
                .where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId));
        });
        throw error;
    }
}
exports.exportWorker = new bullmq_1.Worker(exports.EXPORT_QUEUE, processExportJob, { connection: redisConnection });
exports.parsingWorker.on('failed', (job, err) => console.error(`Parsing ${job?.id} failed: ${err.message}`));
exports.schemaWorker.on('failed', (job, err) => console.error(`Schema ${job?.id} failed: ${err.message}`));
exports.enrichmentWorker.on('failed', (job, err) => console.error(`Enrichment ${job?.id} failed: ${err.message}`));
exports.seoWorker.on('failed', (job, err) => console.error(`SEO ${job?.id} failed: ${err.message}`));
exports.exportWorker.on('failed', (job, err) => console.error(`Export ${job?.id} failed: ${err.message}`));
//# sourceMappingURL=worker.js.map