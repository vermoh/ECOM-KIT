"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectivePermissions = getEffectivePermissions;
const shared_db_1 = require("@ecom-kit/shared-db");
const shared_db_2 = require("@ecom-kit/shared-db");
async function getEffectivePermissions(db, userId, orgId) {
    const [membership] = await db
        .select({
        roleId: shared_db_2.memberships.roleId,
        status: shared_db_2.memberships.status,
        validFrom: shared_db_2.memberships.validFrom,
        validUntil: shared_db_2.memberships.validUntil,
    })
        .from(shared_db_2.memberships)
        .where((0, shared_db_1.and)((0, shared_db_1.eq)(shared_db_2.memberships.userId, userId), (0, shared_db_1.eq)(shared_db_2.memberships.orgId, orgId), (0, shared_db_1.eq)(shared_db_2.memberships.status, 'active')))
        .limit(1);
    if (!membership)
        return { roles: [], permissions: [] };
    const now = new Date();
    if (membership.validFrom > now || (membership.validUntil && membership.validUntil <= now)) {
        return { roles: [], permissions: [] };
    }
    const [org] = await db
        .select({ status: shared_db_2.organizations.status })
        .from(shared_db_2.organizations)
        .where((0, shared_db_1.eq)(shared_db_2.organizations.id, orgId))
        .limit(1);
    if (!org || org.status !== 'active')
        return { roles: [], permissions: [] };
    const [role] = await db
        .select({ name: shared_db_2.roles.name })
        .from(shared_db_2.roles)
        .where((0, shared_db_1.eq)(shared_db_2.roles.id, membership.roleId))
        .limit(1);
    if (!role)
        return { roles: [], permissions: [] };
    if (role.name === 'super_admin') {
        return { roles: [role.name], permissions: ['*'], validUntil: membership.validUntil?.toISOString() };
    }
    const perms = await db
        .select({
        resource: shared_db_2.permissions.resource,
        action: shared_db_2.permissions.action,
    })
        .from(shared_db_2.rolePermissions)
        .innerJoin(shared_db_2.permissions, (0, shared_db_1.eq)(shared_db_2.rolePermissions.permissionId, shared_db_2.permissions.id))
        .where((0, shared_db_1.eq)(shared_db_2.rolePermissions.roleId, membership.roleId));
    const permissionStrings = perms.map((p) => `${p.resource}:${p.action}`);
    return {
        roles: [role.name],
        permissions: permissionStrings,
        validUntil: membership.validUntil?.toISOString()
    };
}
//# sourceMappingURL=rbac.js.map