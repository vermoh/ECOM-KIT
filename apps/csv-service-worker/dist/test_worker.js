"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const worker_1 = require("./worker");
const shared_db_1 = require("@ecom-kit/shared-db");
const s3_1 = require("./lib/s3");
const node_crypto_1 = __importDefault(require("node:crypto"));
const stream_1 = require("stream");
async function runWorkerTests() {
    console.log('--- Phase 5 Worker Tests ---');
    const orgId = node_crypto_1.default.randomUUID();
    const userId = node_crypto_1.default.randomUUID();
    const projectId = node_crypto_1.default.randomUUID();
    const uploadId = node_crypto_1.default.randomUUID();
    try {
        // 1. Setup DB
        await shared_db_1.db.insert(shared_db_1.organizations).values({ id: orgId, name: 'Worker Test Org', slug: `worker-org-${orgId.slice(0, 8)}` });
        await shared_db_1.db.insert(shared_db_1.users).values({ id: userId, email: `worker-${userId.slice(0, 8)}@example.com`, passwordHash: 'hash' });
        await shared_db_1.db.insert(shared_db_1.projects).values({ id: projectId, orgId, name: 'Worker Project' });
        await shared_db_1.db.insert(shared_db_1.uploadJobs).values({ id: uploadId, orgId, projectId, status: 'parsed', s3Key: 'test.csv', originalFilename: 'test.csv' });
        // 2. Mock S3
        const originalSend = s3_1.s3Client.send;
        s3_1.s3Client.send = (async (command) => {
            return {
                Body: stream_1.Readable.from(['header1,header2\nvalue1,value2\n'])
            };
        });
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
            };
        });
        // 4. Run Job
        const mockJob = {
            data: { uploadJobId: uploadId, orgId, s3Key: 'test.csv' }
        };
        await (0, worker_1.processSchemaJob)(mockJob);
        // 5. Assertions
        const template = await shared_db_1.db.query.schemaTemplates.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, uploadId) });
        if (!template)
            throw new Error('Schema template not created');
        const fields = await shared_db_1.db.query.schemaFields.findMany({ where: (0, shared_db_1.eq)(shared_db_1.schemaFields.schemaId, template.id) });
        if (fields.length !== 1)
            throw new Error(`Expected 1 field, got ${fields.length}`);
        if (fields[0].name !== 'header1')
            throw new Error(`Unexpected field name: ${fields[0].name}`);
        const task = await shared_db_1.db.query.reviewTasks.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.reviewTasks.jobId, uploadId) });
        if (!task || task.taskType !== 'schema_review')
            throw new Error('Review task not created');
        console.log('✓ Worker test successful');
        // Restore mocks
        s3_1.s3Client.send = originalSend;
        global.fetch = originalFetch;
        console.log('\nALL WORKER TESTS PASSED! 🚀');
        process.exit(0);
    }
    catch (error) {
        console.error('\nWORKER TEST FAILED ❌');
        console.error(error);
        process.exit(1);
    }
}
runWorkerTests();
//# sourceMappingURL=test_worker.js.map