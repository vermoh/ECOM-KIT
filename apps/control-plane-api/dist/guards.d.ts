import { FastifyReply, FastifyRequest } from 'fastify';
export declare function checkOrgStatus(request: FastifyRequest, reply: FastifyReply): Promise<void>;
export declare function checkTemporalAccess(request: FastifyRequest, reply: FastifyReply): Promise<undefined>;
export declare function requirePermission(permission: string): (request: FastifyRequest, reply: FastifyReply) => Promise<undefined>;
export declare function checkResourceOwnership(request: FastifyRequest, reply: FastifyReply): Promise<undefined>;
//# sourceMappingURL=guards.d.ts.map