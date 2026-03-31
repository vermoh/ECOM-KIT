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
exports.exportWorker = exports.seoWorker = exports.enrichmentWorker = exports.schemaWorker = exports.parsingWorker = exports.seoGenerationQueue = exports.generateSchemaQueue = exports.SEO_GENERATION_QUEUE = exports.EXPORT_QUEUE = exports.ENRICHMENT_QUEUE = exports.GENERATE_SCHEMA_QUEUE = exports.CSV_PARSING_QUEUE = void 0;
exports.processParsingJob = processParsingJob;
exports.processSchemaJob = processSchemaJob;
exports.processEnrichmentJob = processEnrichmentJob;
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
register.registerMetric(jobsProcessedCounter);
register.registerMetric(itemsEnrichedCounter);
register.registerMetric(tokensConsumedCounter);
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
const CP_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:8080';
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
        // 1. Get sample data from S3
        const command = new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: s3Key });
        const response = await s3_1.s3Client.send(command);
        const parser = response.Body.pipe((0, csv_parse_1.parse)({ columns: true, to_line: 5 }));
        const sampleRows = [];
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
            }
            catch (err) {
                console.error('[Schema] Failed to fetch secured key, falling back to env');
            }
        }
        // 2.5 Budget Check
        const hasBudget = await (0, budget_1.checkBudget)(orgId, 10); // Assume 10 tokens for schema
        if (!hasBudget)
            throw new Error('OUT_OF_BUDGET: Not enough tokens for schema generation');
        // 3. Call AI
        const suggestedFields = await (0, ai_1.generateSchemaSuggestion)(headers, sampleRows, apiKey);
        // In real scenario, AI returns tokens used, but here we assume a fix or track it if possible
        await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed: 10, model: 'gpt-3.5-turbo', purpose: 'schema_generation' });
        // 4. Save Schema
        await (0, shared_db_1.withTenant)(orgId, async (tx) => {
            const [template] = await tx.insert(shared_db_1.schemaTemplates).values({
                orgId,
                jobId: uploadJobId,
                status: 'draft',
                aiModel: 'gpt-3.5-turbo',
            }).returning();
            for (let i = 0; i < suggestedFields.length; i++) {
                const field = suggestedFields[i];
                await tx.insert(shared_db_1.schemaFields).values({
                    orgId,
                    schemaId: template.id,
                    name: field.name,
                    label: field.label,
                    fieldType: field.field_type,
                    isRequired: field.is_required || false,
                    allowedValues: field.allowed_values,
                    description: field.description,
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
        // 2. Download CSV
        const command = new client_s3_1.GetObjectCommand({ Bucket: s3_1.BUCKET_NAME, Key: s3Key });
        const response = await s3_1.s3Client.send(command);
        if (!response.Body)
            throw new Error('Empty S3 body');
        const csvContent = await response.Body.transformToString();
        console.log(`[Enrichment] CSV Content retrieved: ${csvContent.length} bytes`);
        const parser = (0, csv_parse_1.parse)(csvContent, { columns: true, skip_empty_lines: true });
        let totalTokens = 0;
        let processedCount = 0;
        let collisionCount = 0;
        // 2. Security: Fetch API key using AccessGrant
        let apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';
        if (job.data.accessGrantToken) {
            try {
                apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
                console.log('[Enrichment] Using secured API key from Control Plane');
            }
            catch (err) {
                console.error('[Enrichment] Failed to fetch secured key, falling back to env');
            }
        }
        // 2.5 Global Budget Check (at least some buffer)
        if (!await (0, budget_1.checkBudget)(orgId, 100)) {
            // SaaS Readiness: Transition to PAUSED instead of just failing
            await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                await tx.update(shared_db_1.enrichmentRuns).set({ status: 'paused', completedAt: new Date() }).where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
                await tx.update(shared_db_1.uploadJobs).set({ status: 'paused', updatedAt: new Date() }).where((0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadJobId));
            });
            throw new Error('OUT_OF_BUDGET: Enrichment paused due to insufficient tokens');
        }
        // 3. Process rows
        for await (const row of parser) {
            console.log(`[Enrichment] Processing row ${processedCount + 1}: ${JSON.stringify(row).slice(0, 50)}`);
            try {
                const { enrichedData, confidence, tokensUsed } = await (0, ai_1.enrichItem)(row, run.template.fields, apiKey);
                totalTokens += tokensUsed;
                processedCount++;
                // Budget Consumption
                await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-3.5-turbo', purpose: 'enrichment' });
                // Metrics
                itemsEnrichedCounter.inc();
                tokensConsumedCounter.inc(tokensUsed);
                // Detect collisions
                const rowCollisions = [];
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
                await (0, shared_db_1.withTenant)(orgId, async (tx) => {
                    const [item] = await tx.insert(shared_db_1.enrichedItems).values({
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
                            await tx.insert(shared_db_1.collisions).values({
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
                        await tx.update(shared_db_1.enrichmentRuns)
                            .set({ processedItems: processedCount, tokensUsed: totalTokens })
                            .where((0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, enrichmentRunId));
                    }
                });
            }
            catch (rowError) {
                console.error(`[Enrichment] Row failed in run ${enrichmentRunId}:`, rowError);
            }
        }
        // 4. Finalize
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
        console.log(`[Enrichment] Run ${enrichmentRunId} completed with ${collisionCount} collisions.`);
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
        let apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-mock-key';
        if (job.data.accessGrantToken) {
            try {
                apiKey = await getProviderKey('openrouter', job.data.accessGrantToken);
                console.log('[SEO] Using secured API key from Control Plane');
            }
            catch (err) {
                console.error('[SEO] Failed to fetch secured key, falling back to env');
            }
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
                await (0, budget_1.consumeBudget)({ orgId, jobId: uploadJobId, tokensUsed, model: 'gpt-3.5-turbo', purpose: 'seo' });
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
            with: { fields: true }
        });
        if (!schema)
            throw new Error('Confirmed schema not found');
        // 2. Fetch all enriched items
        const items = await shared_db_1.db.query.enrichedItems.findMany({
            where: (0, shared_db_1.eq)(shared_db_1.enrichedItems.uploadId, uploadId),
            orderBy: (items, { asc }) => [asc(items.createdAt)]
        });
        // 3. Generate CSV
        const headers = ['sku', ...schema.fields.map(f => f.name)];
        if (includeSeo) {
            headers.push('seo_title', 'seo_description', 'seo_keywords');
        }
        const csvRows = items.map(item => {
            const enriched = JSON.parse(item.enrichedData || '{}');
            const row = {
                sku: item.skuExternalId,
            };
            schema.fields.forEach(f => {
                row[f.name] = enriched[f.name] || '';
            });
            if (includeSeo) {
                row['seo_title'] = enriched['seo_title'] || '';
                row['seo_description'] = enriched['seo_description'] || '';
                row['seo_keywords'] = enriched['seo_keywords'] || '';
            }
            return row;
        });
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