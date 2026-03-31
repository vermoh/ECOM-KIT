import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';

async function main() {
  console.log('Running migrations...');
  const migrationClient = postgres(connectionString, {
    max: 1,
    ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  });
  const db = drizzle(migrationClient);
  
  await migrate(db, { migrationsFolder: './drizzle' });
  
  console.log('Migrations complete!');
  await migrationClient.end();
}

main().catch((err) => {
  console.error('Migration failed!', err);
  process.exit(1);
});
