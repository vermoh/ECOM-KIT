import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgres://ecom_user:ecom_password@localhost:5432/ecom_platform';

// Create a single connection pool for the application
export const connection = postgres(connectionString);
export const db = drizzle(connection, { schema });

// Export all schema tables
export * from './schema';

// Helper to set tenant context for a transaction
export async function withTenant<T>(
  orgId: string,
  callback: (tx: any) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set the session variable for RLS
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return callback(tx);
  });
}
