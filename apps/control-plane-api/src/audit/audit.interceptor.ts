import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user, ip } = request;
    const userAgent = request.headers['user-agent'];

    // Only audit mutations by default (POST, PATCH, DELETE)
    if (['POST', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle().pipe(
        tap(async (data) => {
          try {
            await this.db.insert(schema.auditLogs).values({
              orgId: user?.orgId,
              userId: user?.userId,
              action: `${method} ${url}`,
              resourceType: url.split('/')[3], // Simple resource detection
              payload: JSON.stringify({ body, response: data }), // NOTE: Sensitive data should be filtered!
              ipAddress: ip,
              userAgent: userAgent,
              actorType: user?.userId?.startsWith('service:') ? 'service' : 'user',
            });
          } catch (err) {
            console.error('Failed to log audit event:', err);
          }
        }),
      );
    }

    return next.handle();
  }
}
