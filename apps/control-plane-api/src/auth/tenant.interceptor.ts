import { Injectable, NestInterceptor, ExecutionContext, CallHandler, ForbiddenException, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
import { eq } from 'drizzle-orm';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.orgId) {
      // 1. Verify organization status (active)
      const org = await this.db.query.organizations.findFirst({
        where: eq(schema.organizations.id, user.orgId),
      });

      if (!org || org.status !== 'active') {
        throw new ForbiddenException('Organization is suspended or deleted');
      }

      // 2. Set enterprise context (e.g. for RLS in future or logging)
      // request.org = org;
    }

    return next.handle();
  }
}
