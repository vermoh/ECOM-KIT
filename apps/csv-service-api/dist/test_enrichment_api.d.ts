import { UserSession } from '@ecom-kit/shared-types';
declare module 'fastify' {
    interface FastifyRequest {
        userSession?: UserSession;
    }
}
//# sourceMappingURL=test_enrichment_api.d.ts.map