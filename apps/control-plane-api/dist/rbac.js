"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectivePermissions = getEffectivePermissions;
const drizzle_orm_1 = require("drizzle-orm");
const shared_db_1 = require("@ecom-kit/shared-db");
async function getEffectivePermissions(db, userId, orgId) {
    // 1. Get Membership
    const [membership] = await db
        .select({
        roleId: shared_db_1.memberships.roleId,
        status: shared_db_1.memberships.status,
        validFrom: shared_db_1.memberships.validFrom,
        validUntil: shared_db_1.memberships.validUntil,
    })
        .from(shared_db_1.memberships)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(shared_db_1.memberships.userId, userId), (0, drizzle_orm_1.eq)(shared_db_1.memberships.orgId, orgId), (0, drizzle_orm_1.eq)(shared_db_1.memberships.status, 'active')))
        .limit(1);
    if (!membership)
        return { roles: [], permissions: [] };
    // 2. Temporal Check
    const now = new Date();
    if (membership.validFrom > now || (membership.validUntil && membership.validUntil <= now)) {
        return { roles: [], permissions: [] };
    }
    // 3. Org Status Check
    const [org] = await db
        .select({ status: shared_db_1.organizations.status })
        .from(shared_db_1.organizations)
        .where((0, drizzle_orm_1.eq)(shared_db_1.organizations.id, orgId))
        .limit(1);
    if (!org || org.status !== 'active')
        return { roles: [], permissions: [] };
    // 4. Get Role and Permissions
    const [role] = await db
        .select({ name: shared_db_1.roles.name })
        .from(shared_db_1.roles)
        .where((0, drizzle_orm_1.eq)(shared_db_1.roles.id, membership.roleId))
        .limit(1);
    if (!role)
        return { roles: [], permissions: [] };
    // 5. super_admin shortcut
    if (role.name === 'super_admin') {
        return { roles: [role.name], permissions: ['*'], validUntil: membership.validUntil?.toISOString() };
    }
    // 6. Gather permissions
    const perms = await db
        .select({
        resource: shared_db_1.permissions.resource,
        action: shared_db_1.permissions.action,
    })
        .from(shared_db_1.rolePermissions)
        .innerJoin(shared_db_1.permissions, (0, drizzle_orm_1.eq)(shared_db_1.rolePermissions.permissionId, shared_db_1.permissions.id))
        .where((0, drizzle_orm_1.eq)(shared_db_1.rolePermissions.roleId, membership.roleId));
    const permissionStrings = perms.map((p) => `${p.resource}:${p.action}`);
    return {
        roles: [role.name],
        permissions: permissionStrings,
        validUntil: membership.validUntil?.toISOString()
    };
}
//# sourceMappingURL=rbac.js.map