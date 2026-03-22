import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
export declare class RolesService {
    private readonly db;
    constructor(db: PostgresJsDatabase<typeof schema>);
    findRoleWithPermissions(roleId: string): Promise<{
        permissions: string[];
        id?: string | undefined;
        name?: string | undefined;
        createdAt?: Date | undefined;
        orgId?: string | null | undefined;
        description?: string | null | undefined;
        isSystem?: boolean | undefined;
    }>;
    getRoleByName(name: string, orgId?: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        orgId: string | null;
        description: string | null;
        isSystem: boolean;
    } | undefined>;
}
//# sourceMappingURL=roles.service.d.ts.map