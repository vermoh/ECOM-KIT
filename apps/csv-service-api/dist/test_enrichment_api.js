"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const enrichment_1 = require("./routes/enrichment");
const shared_db_1 = require("@ecom-kit/shared-db");
const uuid_1 = require("uuid");
async function runApiTests() {
    const app = (0, fastify_1.default)();
    const orgId = (0, uuid_1.v4)();
    const userId = (0, uuid_1.v4)();
    const projectId = (0, uuid_1.v4)();
    const uploadId = (0, uuid_1.v4)();
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
    app.register(enrichment_1.enrichmentRoutes);
    await app.ready();
    console.log('--- Phase 6 Enrichment API Tests ---');
    try {
        // 1. Setup DB
        await shared_db_1.db.insert(shared_db_1.organizations).values({ id: orgId, name: 'API Test Org', slug: `api-org-${orgId.slice(0, 8)}` });
        await shared_db_1.db.insert(shared_db_1.users).values({ id: userId, email: `api-${userId.slice(0, 8)}@example.com`, passwordHash: 'hash' });
        await shared_db_1.db.insert(shared_db_1.projects).values({ id: projectId, orgId, name: 'API Project' });
        await shared_db_1.db.insert(shared_db_1.uploadJobs).values({
            id: uploadId,
            orgId,
            projectId,
            status: 'schema_confirmed',
            s3Key: 'test.csv',
            originalFilename: 'test.csv'
        });
        await shared_db_1.db.insert(shared_db_1.schemaTemplates).values({
            id: (0, uuid_1.v4)(),
            orgId,
            jobId: uploadId,
            status: 'confirmed',
            aiModel: 'gpt-3.5-turbo'
        });
        console.log('✓ Setup complete');
        // 2. Test: POST /uploads/:id/enrichment/start
        const res = await app.inject({
            method: 'POST',
            url: `/uploads/${uploadId}/enrichment/start`
        });
        if (res.statusCode !== 200)
            throw new Error(`POST /enrichment/start failed: ${res.payload}`);
        const payload = JSON.parse(res.payload);
        if (!payload.enrichmentRunId)
            throw new Error('enrichmentRunId missing in response');
        // 3. Verify Job status
        const updatedJob = await shared_db_1.db.query.uploadJobs.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId) });
        if (updatedJob?.status !== 'enriching')
            throw new Error(`Job status mismatch: ${updatedJob?.status}`);
        console.log('✓ API POST /enrichment/start successful');
        console.log('\nALL API TESTS PASSED! 🚀');
        process.exit(0);
    }
    catch (error) {
        console.error('\nAPI TEST FAILED ❌');
        console.error(error);
        process.exit(1);
    }
}
runApiTests();
//# sourceMappingURL=test_enrichment_api.js.map