import { FastifyReply, FastifyRequest } from 'fastify';
import { UserSession } from '@ecom-kit/shared-types';
import { hasPermission } from '@ecom-kit/shared-auth';

export async function checkOrgStatus(request: FastifyRequest, reply: FastifyReply) {
  const session = request.userSession;
  if (!session) return;

  // In a real app, we would fetch org status from Redis/DB here
  // For now, we assume it's checked during token generation/refresh, 
  // but we could add a cached check here for immediate suspension.
}

export async function checkTemporalAccess(request: FastifyRequest, reply: FastifyReply) {
  const session = request.userSession;
  if (!session || !session.validUntil) return;

  const validUntil = new Date(session.validUntil);
  if (validUntil <= new Date()) {
    reply.status(403).send({ error: 'ACCESS_EXPIRED', message: 'Your membership has expired' });
    return reply;
  }
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = request.userSession;
    if (!session) {
      reply.status(401).send({ error: 'Unauthorized' });
      return reply;
    }

    if (!hasPermission(session, permission)) {
      reply.status(403).send({ error: 'PERMISSION_DENIED', action: 'access.denied', permission });
      return reply;
    }
  };
}

export async function checkResourceOwnership(request: FastifyRequest, reply: FastifyReply) {
  const session = request.userSession;
  const { orgId } = request.params as { orgId?: string };
  
  if (session && orgId && session.orgId !== orgId) {
    reply.status(403).send({ error: 'PERMISSION_DENIED', message: 'Resource belongs to another tenant' });
    return reply;
  }
}
