import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from './schema.js';
import { hashPassword } from '@ecom-kit/shared-auth';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';
const client = postgres(connectionString);
const db = drizzle(client);

async function seed() {
  console.log('Seeding database...');

  const hashedPassword = await hashPassword('admin123');
  
  await db.insert(users).values({
    email: 'admin@ecomkit.com',
    passwordHash: hashedPassword,
  }).onConflictDoNothing();

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed!', err);
  process.exit(1);
});
