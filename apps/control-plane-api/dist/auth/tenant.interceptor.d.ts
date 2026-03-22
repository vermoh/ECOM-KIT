import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
export declare class TenantInterceptor implements NestInterceptor {
    private readonly db;
    constructor(db: PostgresJsDatabase<typeof schema>);
    intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>>;
}
//# sourceMappingURL=tenant.interceptor.d.ts.map