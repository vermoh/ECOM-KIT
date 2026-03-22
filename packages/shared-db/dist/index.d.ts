import postgres from 'postgres';
import * as schema from './schema';
export { eq, and, or, desc, asc, sql, count } from 'drizzle-orm';
export declare const connection: postgres.Sql<{}>;
export declare const db: import("drizzle-orm/postgres-js").PostgresJsDatabase<typeof schema>;
export * from './schema';
export declare function withTenant<T>(orgId: string, callback: (tx: any) => Promise<T>): Promise<T>;
//# sourceMappingURL=index.d.ts.map