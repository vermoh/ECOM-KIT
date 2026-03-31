import { db, organizations, users, memberships, roles, eq, and, isNull } from './packages/shared-db/src/index.ts';

async function setup() {
  console.log('Ensuring admin has an organization...');
  const [user] = await db.select().from(users).where(eq(users.email, 'admin@ecomkit.com')).limit(1);
  const [role] = await db.select().from(roles).where(and(eq(roles.name, 'super_admin'), isNull(roles.orgId))).limit(1);
  
  if (!user || !role) {
    console.error('Admin user or super_admin role not found. Run seed first.');
    process.exit(1);
  }

  let [org] = await db.select().from(organizations).limit(1);
  if (!org) {
     [org] = await db.insert(organizations).values({ name: 'Default Org', slug: 'default' }).returning();
     console.log('Created new organization:', org.id);
  } else {
     console.log('Using existing organization:', org.id);
  }

  await db.insert(memberships).values({ 
    orgId: org.id, 
    userId: user.id, 
    roleId: role.id, 
    status: 'active' 
  }).onConflictDoNothing();
  
  console.log('Admin membership ensured for org:', org.id);
  process.exit(0);
}

setup().catch(err => {
  console.error(err);
  process.exit(1);
});
