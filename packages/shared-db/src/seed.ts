import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { isNull, eq } from 'drizzle-orm';
import { users, roles, permissions, rolePermissions, services, serviceAccess, organizations } from './schema.js';
import { hashPassword } from '@ecom-kit/shared-auth';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

const ALL_PERMISSIONS = [
  // Organizations
  { resource: 'organization', action: 'create' },
  { resource: 'organization', action: 'read' },
  { resource: 'organization', action: 'update' },
  { resource: 'organization', action: 'suspend' },
  { resource: 'organization', action: 'delete' },
  // Users
  { resource: 'user', action: 'invite' },
  { resource: 'user', action: 'read' },
  { resource: 'user', action: 'update_role' },
  { resource: 'user', action: 'suspend' },
  { resource: 'user', action: 'remove' },
  { resource: 'user', action: 'set_expiry' },
  // Services
  { resource: 'service', action: 'register' },
  { resource: 'service', action: 'grant_access' },
  { resource: 'service', action: 'revoke_access' },
  { resource: 'service', action: 'read' },
  // CSV Projects
  { resource: 'project', action: 'create' },
  { resource: 'project', action: 'read' },
  { resource: 'project', action: 'update' },
  { resource: 'project', action: 'archive' },
  { resource: 'upload', action: 'create' },
  { resource: 'upload', action: 'read' },
  { resource: 'upload', action: 'delete' },
  // Schema
  { resource: 'schema', action: 'read' },
  { resource: 'schema', action: 'update' },
  { resource: 'schema', action: 'approve' },
  { resource: 'schema', action: 'reject' },
  // Enrichment
  { resource: 'enrichment', action: 'start' },
  { resource: 'enrichment', action: 'read' },
  { resource: 'enrichment', action: 'cancel' },
  { resource: 'collision', action: 'read' },
  { resource: 'collision', action: 'resolve' },
  { resource: 'seo', action: 'start' },
  { resource: 'seo', action: 'read' },
  // Export
  { resource: 'export', action: 'create' },
  { resource: 'export', action: 'read' },
  { resource: 'export', action: 'download' },
  // Secrets
  { resource: 'secret', action: 'create' },
  { resource: 'secret', action: 'read_hint' },
  { resource: 'secret', action: 'rotate' },
  { resource: 'secret', action: 'delete' },
  // Audit
  { resource: 'audit', action: 'read_own_org' },
  { resource: 'audit', action: 'read_all_orgs' },
  { resource: 'audit', action: 'export' },
];

const SYSTEM_ROLES = [
  { name: 'super_admin', description: 'Platform-wide access' },
  { name: 'organization_owner', description: 'Full control of organization' },
  { name: 'organization_admin', description: 'User management and operations' },
  { name: 'manager', description: 'Project and enrichment management' },
  { name: 'operator', description: 'CSV uploads and task starts' },
  { name: 'reviewer', description: 'Human-in-the-loop validation' },
  { name: 'analyst', description: 'Results analysis and export' },
  { name: 'service_user', description: 'Machine API access' },
  { name: 'read_only', description: 'View only access' },
];

async function seed() {
  console.log('Seeding database with RBAC model...');

  // 1. Permissions
  console.log('Upserting permissions...');
  const upsertedPermissions = [];
  for (const p of ALL_PERMISSIONS) {
    const [perm] = await db.insert(permissions).values(p).onConflictDoUpdate({
      target: [permissions.resource, permissions.action],
      set: { resource: p.resource, action: p.action }
    }).returning();
    upsertedPermissions.push(perm);
  }

  // 2. Roles
  console.log('Upserting roles...');
  const roleMap: Record<string, any> = {};
  for (const r of SYSTEM_ROLES) {
    const [role] = await db.insert(roles).values({
      ...r,
      isSystem: true,
      orgId: null,
    }).onConflictDoUpdate({
      target: [roles.name, roles.orgId],
      set: { description: r.description },
      where: isNull(roles.orgId)
    }).returning();
    roleMap[r.name] = role;
  }

  // 3. Role Permissions (simplified mapping for seeding)
  console.log('Setting role permissions...');
  for (const roleName in roleMap) {
    const roleId = roleMap[roleName].id;
    let rolePerms = [];

    if (roleName === 'super_admin') {
      rolePerms = upsertedPermissions;
    } else if (roleName === 'organization_owner') {
      rolePerms = upsertedPermissions.filter(p => p.resource !== 'audit' || p.action !== 'read_all_orgs');
    }
    // More precise filtering should be added here based on rbac_abac.md matrix
    // For now, let's at least grant basic read for all roles
    else {
      rolePerms = upsertedPermissions.filter(p => p.action === 'read' || p.action.includes('read_'));
    }

    if (rolePerms.length > 0) {
      await db.insert(rolePermissions).values(
        rolePerms.map(p => ({ roleId, permissionId: p.id }))
      ).onConflictDoNothing();
    }
  }

  // 4. Admin User
  console.log('Creating super_admin user...');
  const hashedPassword = await hashPassword('admin123');
  await db.insert(users).values({
    email: 'admin@ecomkit.com',
    passwordHash: hashedPassword,
    status: 'active',
    isSuperAdmin: true,
  }).onConflictDoUpdate({
    target: [users.email],
    set: { status: 'active', isSuperAdmin: true }
  });

  // 5. Register csv-service-worker service
  console.log('Registering csv-service-worker service...');
  const [csvService] = await db.insert(services).values({
    slug: 'csv-service-worker',
    name: 'CSV Service Worker',
    baseUrl: process.env.CSV_SERVICE_URL || 'http://localhost:4001',
    version: '1.0.0',
    status: 'active',
  }).onConflictDoUpdate({
    target: [services.slug],
    set: { status: 'active' }
  }).returning();

  // 6. Grant all existing organizations access to csv-service-worker
  console.log('Granting service access to all organizations...');
  const allOrgs = await db.select({ id: organizations.id }).from(organizations);
  const adminUser = await db.select({ id: users.id }).from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  const grantedBy = adminUser[0]?.id;

  if (grantedBy && allOrgs.length > 0) {
    await db.insert(serviceAccess).values(
      allOrgs.map(org => ({
        orgId: org.id,
        serviceId: csvService.id,
        enabled: true,
        grantedBy,
      }))
    ).onConflictDoNothing();
    console.log(`Granted csv-service-worker access to ${allOrgs.length} organization(s)`);
  } else {
    console.log('No organizations found — service access will be granted when orgs are created');
  }

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed!', err);
  process.exit(1);
});
