import { UserSession } from '@ecom-kit/shared-types';
declare module 'fastify' {
    interface FastifyRequest {
        userSession?: UserSession;
    }
}
//# sourceMappingURL=server.d.ts.map