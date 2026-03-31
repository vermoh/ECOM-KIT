import postgres from 'postgres';
import * as schema from './schema.js';
export { eq, and, or, desc, asc, sql, count, isNull, type SQL } from 'drizzle-orm';
export declare const connection: postgres.Sql<{}>;
export declare const db: import("node_modules/drizzle-orm/postgres-js/driver.js").PostgresJsDatabase<typeof schema>;
export * from './schema.js';
export declare function withTenant<T>(orgId: string, callback: (tx: any) => Promise<T>): Promise<T>;
//# sourceMappingURL=index.d.ts.map