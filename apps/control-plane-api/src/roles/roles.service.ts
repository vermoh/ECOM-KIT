import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
import { eq, and } from '@ecom-kit/shared-db';

@Injectable()
export class RolesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findRoleWithPermissions(roleId: string) {
    const role = await this.db.query.roles.findFirst({
      where: eq(schema.roles.id, roleId),
      with: {
        // Need to check if relations are defined in schema.ts for roles to rolePermissions
      }
    });
    
    // Manual join if relations not available or simple
    const permissions = await this.db
      .select({
        resource: schema.permissions.resource,
        action: schema.permissions.action,
      })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.rolePermissions.roleId, roleId));

    return {
      ...role,
      permissions: permissions.map(p => `${p.resource}:${p.action}`),
    };
  }

  async getRoleByName(name: string, orgId?: string) {
    return this.db.query.roles.findFirst({
      where: orgId 
        ? and(eq(schema.roles.name, name), eq(schema.roles.orgId, orgId))
        : and(eq(schema.roles.name, name), eq(schema.roles.isSystem, true)),
    });
  }
}
