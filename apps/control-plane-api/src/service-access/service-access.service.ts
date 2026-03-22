import { Injectable, Inject, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
import { eq, and } from 'drizzle-orm';
import * as crypto from 'node:crypto';

@Injectable()
export class ServiceAccessService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAllServices() {
    return this.db.query.services.findMany();
  }

  async grantAccess(orgId: string, serviceId: string, grantedBy: string) {
    const [access] = await this.db.insert(schema.serviceAccess).values({
      orgId,
      serviceId,
      grantedBy,
      enabled: true,
    }).returning();
    return access;
  }

  async createAccessGrant(orgId: string, serviceId: string, scopes: string[]) {
    // 1. Verify organization has access to this service
    const access = await this.db.query.serviceAccess.findFirst({
      where: and(
        eq(schema.serviceAccess.orgId, orgId),
        eq(schema.serviceAccess.serviceId, serviceId),
        eq(schema.serviceAccess.enabled, true),
      ),
    });

    if (!access) {
      throw new UnauthorizedException('Organization does not have access to this service');
    }

    // 2. Generate short-lived token (15 mins)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const [grant] = await this.db.insert(schema.accessGrants).values({
      orgId,
      serviceId,
      tokenHash,
      scopes,
      expiresAt,
    }).returning();

    return {
      ...grant,
      token: rawToken, // Only return raw token once
    };
  }
}
