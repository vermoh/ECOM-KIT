"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const shared_auth_1 = require("@ecom-kit/shared-auth");
const redis_1 = __importDefault(require("@fastify/redis"));
const cors_1 = __importDefault(require("@fastify/cors"));
const fastify_metrics_1 = __importDefault(require("fastify-metrics"));
const auth_js_1 = require("./routes/auth.js");
const fastify = (0, fastify_1.default)({
    logger: true
});
fastify.register(cors_1.default, {
    origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
    credentials: true,
});
fastify.setErrorHandler(function (error, request, reply) {
    this.log.error(error);
    if (error.statusCode === 401) {
        reply.status(401).send({ error: 'Unauthorized', message: error.message });
    }
    else if (error.statusCode === 403) {
        reply.status(403).send({ error: 'Forbidden' });
    }
    else {
        reply.status(500).send({ error: 'Internal Server Error' });
    }
});
const guards_js_1 = require("./guards.js");
const shared_db_1 = require("@ecom-kit/shared-db");
const node_crypto_1 = __importDefault(require("node:crypto"));
fastify.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url.startsWith('/api/v1/auth') || request.url === '/api/v1/grants/verify')
        return;
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401).send({ error: 'Unauthorized: No token provided' });
        return reply;
    }
    const token = authHeader.split(' ')[1];
    try {
        if (token.includes('.') && token.split('.').length === 3) {
            const session = (0, shared_auth_1.verifyToken)(token);
            request.userSession = session;
            await (0, guards_js_1.checkOrgStatus)(request, reply);
            if (reply.sent)
                return;
            await (0, guards_js_1.checkTemporalAccess)(request, reply);
            if (reply.sent)
                return;
            return;
        }
        const tokenHash = node_crypto_1.default.createHash('sha256').update(token).digest('hex');
        const [grant] = await shared_db_1.db.select().from(shared_db_1.accessGrants).where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_1.accessGrants.tokenHash, tokenHash), (0, shared_db_1.isNull)(shared_db_1.accessGrants.revokedAt))).limit(1);
        if (grant && grant.expiresAt > new Date()) {
            request.userSession = {
                userId: `service:${grant.serviceId}`,
                orgId: grant.orgId,
                roles: [],
                permissions: grant.scopes,
                exp: Math.floor(grant.expiresAt.getTime() / 1000)
            };
            return;
        }
        throw new Error('Invalid or expired token');
    }
    catch (err) {
        reply.status(401).send({ error: 'Unauthorized: Invalid token', details: err.message });
        return reply;
    }
});
fastify.register(redis_1.default, {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
});
fastify.register(fastify_metrics_1.default, { endpoint: '/metrics' });
const organizations_js_1 = require("./routes/organizations.js");
const memberships_js_1 = require("./routes/memberships.js");
const providers_js_1 = require("./routes/providers.js");
const services_js_1 = require("./routes/services.js");
const grants_js_1 = require("./routes/grants.js");
const billing_js_1 = require("./routes/billing.js");
const admin_js_1 = require("./routes/admin.js");
fastify.register(auth_js_1.authRoutes, { prefix: '/api/v1/auth' });
fastify.register(organizations_js_1.organizationRoutes, { prefix: '/api/v1/organizations' });
fastify.register(memberships_js_1.membershipRoutes, { prefix: '/api/v1/memberships' });
fastify.register(providers_js_1.providerRoutes, { prefix: '/api/v1/providers' });
fastify.register(services_js_1.serviceRoutes, { prefix: '/api/v1/services' });
fastify.register(grants_js_1.grantRoutes, { prefix: '/api/v1/grants' });
fastify.register(billing_js_1.billingRoutes, { prefix: '/api/v1/billing' });
fastify.register(admin_js_1.adminRoutes, { prefix: '/api/v1/admin' });
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', service: 'control-plane-api' };
});
fastify.get('/api/v1/protected', async (request, reply) => {
    return { data: 'This is protected data', session: request.userSession };
});
const start = async () => {
    try {
        await fastify.listen({ port: parseInt(process.env.PORT || '4000'), host: '0.0.0.0' });
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=server.js.map