"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const schema_1 = require("./routes/schema");
const uploads_1 = require("./routes/uploads");
const shared_db_1 = require("@ecom-kit/shared-db");
const uuid_1 = require("uuid");
async function runTests() {
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
    app.register(schema_1.schemaRoutes);
    app.register(uploads_1.uploadRoutes);
    await app.ready();
    console.log('--- Phase 5 Integration Tests ---');
    try {
        // -1. Setup: Create Org and User to satisfy FK
        await shared_db_1.db.insert(shared_db_1.organizations).values({
            id: orgId,
            name: 'Test Org',
            slug: `test-org-${orgId.slice(0, 8)}`
        });
        await shared_db_1.db.insert(shared_db_1.users).values({
            id: userId,
            email: `test-${userId.slice(0, 8)}@example.com`,
            passwordHash: 'dummy-hash'
        });
        // 0. Setup: Create Project and UploadJob
        await shared_db_1.db.insert(shared_db_1.projects).values({
            id: projectId,
            orgId,
            name: 'Test Project'
        });
        await shared_db_1.db.insert(shared_db_1.uploadJobs).values({
            id: uploadId,
            orgId,
            projectId,
            status: 'parsed',
            s3Key: 'test/key.csv',
            originalFilename: 'test.csv'
        });
        // 1. Setup: Create initial schema draft
        await shared_db_1.db.insert(shared_db_1.schemaTemplates).values({
            id: (0, uuid_1.v4)(),
            orgId,
            jobId: uploadId,
            status: 'draft',
            aiModel: 'gpt-3.5-turbo'
        });
        console.log('✓ Setup complete');
        // 2. Test: GET /uploads/:id/schema
        const getRes = await app.inject({
            method: 'GET',
            url: `/uploads/${uploadId}/schema`
        });
        if (getRes.statusCode !== 200)
            throw new Error(`GET /schema failed: ${getRes.payload}`);
        console.log('✓ GET /schema successful');
        // 3. Test: PATCH /uploads/:id/schema
        const patchRes = await app.inject({
            method: 'PATCH',
            url: `/uploads/${uploadId}/schema`,
            body: {
                fields: [
                    { name: 'color', label: 'Color', fieldType: 'text', isRequired: false },
                    { name: 'size', label: 'Size', fieldType: 'enum', isRequired: true, allowedValues: ['S', 'M', 'L'] }
                ]
            }
        });
        if (patchRes.statusCode !== 200)
            throw new Error(`PATCH /schema failed: ${patchRes.payload}`);
        // Verify fields in DB
        const template = await shared_db_1.db.query.schemaTemplates.findFirst({
            where: (0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, uploadId),
            with: { fields: true }
        });
        if (template?.fields.length !== 2)
            throw new Error('Field mismatch after PATCH');
        console.log('✓ PATCH /schema successful');
        // 4. Test: POST /uploads/:id/schema/approve
        const approveRes = await app.inject({
            method: 'POST',
            url: `/uploads/${uploadId}/schema/approve`
        });
        if (approveRes.statusCode !== 200)
            throw new Error(`POST /approve failed: ${approveRes.payload}`);
        // Verify states
        const updatedJob = await shared_db_1.db.query.uploadJobs.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.uploadJobs.id, uploadId) });
        if (updatedJob?.status !== 'schema_confirmed')
            throw new Error(`Job status not confirmed: ${updatedJob?.status}`);
        const updatedTemplate = await shared_db_1.db.query.schemaTemplates.findFirst({ where: (0, shared_db_1.eq)(shared_db_1.schemaTemplates.jobId, uploadId) });
        if (updatedTemplate?.status !== 'confirmed')
            throw new Error('Schema status not confirmed');
        console.log('✓ POST /approve successful');
        console.log('\nALL TESTS PASSED! 🚀');
        process.exit(0);
    }
    catch (error) {
        console.error('\nTEST FAILED ❌');
        console.error(error);
        process.exit(1);
    }
}
runTests();
//# sourceMappingURL=test_integration.js.map