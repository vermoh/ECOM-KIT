import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
export { eq, and, or, desc, asc, sql, count, isNull, inArray, type SQL } from 'drizzle-orm';
import { sql as drizzleSql } from 'drizzle-orm';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';

// Create a single connection pool for the application
export const connection = postgres(connectionString, {
  ssl: process.env.DB_SSL === 'true' ? 'require' : false,
});
export const db = drizzle(connection, { schema });

// Export all schema tables
export * from './schema.js';

// Helper to set tenant context for a transaction
export async function withTenant<T>(
  orgId: string,
  callback: (tx: any) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set the session variable for RLS
    await tx.execute(drizzleSql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return callback(tx);
  });
}
