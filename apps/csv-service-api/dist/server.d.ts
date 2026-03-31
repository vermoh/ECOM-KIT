import { UserSession } from '@ecom-kit/shared-types';
declare module 'fastify' {
    interface FastifyRequest {
        userSession?: UserSession;
        accessGrant?: any;
        correlationId?: string;
    }
}
//# sourceMappingURL=server.d.ts.map