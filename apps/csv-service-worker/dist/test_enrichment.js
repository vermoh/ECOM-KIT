"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_1 = require("./worker");
const shared_db_1 = require("@ecom-kit/shared-db");
const s3_1 = require("./lib/s3");
const stream_1 = require("stream");
const node_crypto_1 = __importDefault(require("node:crypto"));
async function runEnrichmentTests() {
    console.log('--- Phase 6 Enrichment Worker Tests ---');
    const orgId = node_crypto_1.default.randomUUID();
    const userId = node_crypto_1.default.randomUUID();
    const projectId = node_crypto_1.default.randomUUID();
    const uploadId = node_crypto_1.default.randomUUID();
    const schemaId = node_crypto_1.default.randomUUID();
    const runId = node_crypto_1.default.randomUUID();
    try {
        // 1. Setup DB
        await shared_db_1.db.insert(shared_db_1.organizations).values({ id: orgId, name: 'Enrichment Test Org', slug: `enrich-org-${orgId.slice(0, 8)}` });
        await shared_db_1.db.insert(shared_db_1.users).values({ id: userId, email: `enrich-${userId.slice(0, 8)}@example.com`, passwordHash: 'hash' });
        await shared_db_1.db.insert(shared_db_1.projects).values({ id: projectId, orgId, name: 'Enrichment Project' });
        await shared_db_1.db.insert(shared_db_1.uploadJobs).values({
            id: uploadId,
            orgId,
            projectId,
            status: 'schema_confirmed',
            s3Key: 'test.csv',
            originalFilename: 'test.csv',
            rowCount: 1
        });
        await shared_db_1.db.insert(shared_db_1.schemaTemplates).values({
            id: schemaId,
            orgId,
            jobId: uploadId,
            status: 'confirmed',
            aiModel: 'gpt-3.5-turbo'
        });
        await shared_db_1.db.insert(shared_db_1.schemaFields).values({
            orgId,
            schemaId,
            name: 'color',
            label: 'Color',
            fieldType: 'text'
        });
        await shared_db_1.db.insert(shared_db_1.enrichmentRuns).values({
            id: runId,
            orgId,
            jobId: uploadId,
            schemaId,
            status: 'queued',
            totalItems: 1
        });
        // 2. Mock S3
        const originalSend = s3_1.s3Client.send;
        s3_1.s3Client.send = (async (command) => {
            return {
                Body: stream_1.Readable.from(['sku,name\nSKU001,Red T-Shirt\n'])
            };
        });
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
            };
        });
        // 4. Run Job
        const mockJob = {
            data: { enrichmentRunId: runId, uploadJobId: uploadId, orgId, s3Key: 'test.csv' }
        };
        await (0, worker_1.processEnrichmentJob)(mockJob);
        // 5. Assertions
        const run = await shared_db_1.db.query.enrichmentRuns.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.enrichmentRuns.id, runId) });
        if (!run || run.status !== 'completed')
            throw new Error(`Run status: ${run?.status}`);
        if (run.processedItems !== 1)
            throw new Error(`Processed items: ${run.processedItems}`);
        const item = await shared_db_1.db.query.enrichedItems.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.enrichedItems.runId, runId) });
        if (!item)
            throw new Error('Enriched item not created');
        const enrichedData = JSON.parse(item.enrichedData);
        if (enrichedData.color !== 'Red')
            throw new Error(`Enriched data mismatch: ${item.enrichedData}`);
        const job = await shared_db_1.db.query.uploadJobs.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId) });
        if (job?.status !== 'enriched')
            throw new Error(`Job status: ${job?.status}`);
        console.log('✓ Enrichment worker test successful');
        // Restore mocks
        s3_1.s3Client.send = originalSend;
        global.fetch = originalFetch;
        console.log('\nALL ENRICHMENT WORKER TESTS PASSED! 🚀');
        process.exit(0);
    }
    catch (error) {
        console.error('\nENRICHMENT WORKER TEST FAILED ❌');
        console.error(error);
        process.exit(1);
    }
}
runEnrichmentTests();
//# sourceMappingURL=test_enrichment.js.map