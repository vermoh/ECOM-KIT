"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkOrgStatus = checkOrgStatus;
exports.checkTemporalAccess = checkTemporalAccess;
exports.requirePermission = requirePermission;
exports.checkResourceOwnership = checkResourceOwnership;
const shared_auth_1 = require("@ecom-kit/shared-auth");
async function checkOrgStatus(request, reply) {
    const session = request.userSession;
    if (!session)
        return;
    // In a real app, we would fetch org status from Redis/DB here
    // For now, we assume it's checked during token generation/refresh, 
    // but we could add a cached check here for immediate suspension.
}
async function checkTemporalAccess(request, reply) {
    const session = request.userSession;
    if (!session || !session.validUntil)
        return;
    const validUntil = new Date(session.validUntil);
    if (validUntil <= new Date()) {
        reply.status(403).send({ error: 'ACCESS_EXPIRED', message: 'Your membership has expired' });
        return reply;
    }
}
function requirePermission(permission) {
    return async (request, reply) => {
        const session = request.userSession;
        if (!session) {
            reply.status(401).send({ error: 'Unauthorized' });
            return reply;
        }
        if (!(0, shared_auth_1.hasPermission)(session, permission)) {
            reply.status(403).send({ error: 'PERMISSION_DENIED', action: 'access.denied', permission });
            return reply;
        }
    };
}
async function checkResourceOwnership(request, reply) {
    const session = request.userSession;
    const { orgId } = request.params;
    if (session && orgId && session.orgId !== orgId) {
        reply.status(403).send({ error: 'PERMISSION_DENIED', message: 'Resource belongs to another tenant' });
        return reply;
    }
}
//# sourceMappingURL=guards.js.map