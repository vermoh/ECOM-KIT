import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RolesService } from '../roles/roles.service';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
export declare class AuthService {
    private usersService;
    private rolesService;
    private jwtService;
    private readonly db;
    constructor(usersService: UsersService, rolesService: RolesService, jwtService: JwtService, db: PostgresJsDatabase<typeof schema>);
    validateUser(email: string, pass: string): Promise<any>;
    login(user: any, orgId: string): Promise<{
        access_token: string;
    }>;
    verifyServiceToken(token: string): Promise<{
        userId: string;
        orgId: string;
        roles: never[];
        permissions: string[];
        exp: number;
    } | null>;
}
//# sourceMappingURL=auth.service.d.ts.map