import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RolesService } from '../roles/roles.service';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE } from '../db/db.module';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
import { eq, and, isNull } from '@ecom-kit/shared-db';
import * as crypto from 'node:crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private rolesService: RolesService,
    private jwtService: JwtService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any, orgId: string) {
    // Super admin can login without org
    if (user.isSuperAdmin && !orgId) {
      const payload = {
        sub: user.id,
        org_id: null,
        role: 'super_admin',
        permissions: ['*'],
        iss: 'ecomkit-cp',
      };
      return { access_token: this.jwtService.sign(payload) };
    }

    // Get user membership and role for this org
    const membership = await this.db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.orgId, orgId),
        eq(schema.memberships.status, 'active')
      )
    });

    if (!membership) {
      throw new UnauthorizedException('User is not a member of this organization');
    }

    const roleWithPerms = await this.rolesService.findRoleWithPermissions(membership.roleId);

    const payload = {
      sub: user.id,
      org_id: orgId,
      role: roleWithPerms.name,
      permissions: roleWithPerms.permissions,
      valid_until: membership.validUntil?.toISOString(),
      iss: 'ecomkit-cp',
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async verifyServiceToken(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const grant = await this.db.query.accessGrants.findFirst({
      where: and(
        eq(schema.accessGrants.tokenHash, tokenHash),
        isNull(schema.accessGrants.revokedAt)
      )
    });

    if (grant && grant.expiresAt > new Date()) {
      return {
        userId: `service:${grant.serviceId}`,
        orgId: grant.orgId,
        roles: [],
        permissions: grant.scopes,
        exp: Math.floor(grant.expiresAt.getTime() / 1000)
      };
    }

    return null;
  }
}
