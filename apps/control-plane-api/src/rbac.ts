import { eq, and, isNull, SQL } from 'drizzle-orm';
import { 
  memberships, 
  roles, 
  rolePermissions, 
  permissions, 
  organizations,
  users 
} from '@ecom-kit/shared-db';

export async function getEffectivePermissions(db: any, userId: string, orgId: string) {
  // 1. Get Membership
  const [membership] = await db
    .select({
      roleId: memberships.roleId,
      status: memberships.status,
      validFrom: memberships.validFrom,
      validUntil: memberships.validUntil,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.orgId, orgId),
        eq(memberships.status, 'active')
      )
    )
    .limit(1);

  if (!membership) return { roles: [], permissions: [] };

  // 2. Temporal Check
  const now = new Date();
  if (membership.validFrom > now || (membership.validUntil && membership.validUntil <= now)) {
    return { roles: [], permissions: [] };
  }

  // 3. Org Status Check
  const [org] = await db
    .select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org || org.status !== 'active') return { roles: [], permissions: [] };

  // 4. Get Role and Permissions
  const [role] = await db
    .select({ name: roles.name })
    .from(roles)
    .where(eq(roles.id, membership.roleId))
    .limit(1);

  if (!role) return { roles: [], permissions: [] };

  // 5. super_admin shortcut
  if (role.name === 'super_admin') {
    return { roles: [role.name], permissions: ['*'], validUntil: membership.validUntil?.toISOString() };
  }

  // 6. Gather permissions
  const perms = await db
    .select({
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, membership.roleId));

  const permissionStrings = perms.map((p: any) => `${p.resource}:${p.action}`);

  return { 
    roles: [role.name], 
    permissions: permissionStrings, 
    validUntil: membership.validUntil?.toISOString() 
  };
}
