import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
export declare class UsersService {
    private readonly db;
    constructor(db: PostgresJsDatabase<typeof schema>);
    findOne(id: string): Promise<{
        id: string;
        status: "active" | "deleted" | "locked" | "pending";
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        email: string;
        passwordHash: string;
        isSuperAdmin: boolean;
        lastLoginAt: Date | null;
    }>;
    findByEmail(email: string): Promise<{
        id: string;
        status: "active" | "deleted" | "locked" | "pending";
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        email: string;
        passwordHash: string;
        isSuperAdmin: boolean;
        lastLoginAt: Date | null;
    } | undefined>;
    create(data: typeof schema.users.$inferInsert): Promise<{
        id: string;
        status: "active" | "deleted" | "locked" | "pending";
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        email: string;
        passwordHash: string;
        isSuperAdmin: boolean;
        lastLoginAt: Date | null;
    }>;
    update(id: string, data: Partial<typeof schema.users.$inferInsert>): Promise<{
        id: string;
        status: "active" | "deleted" | "locked" | "pending";
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        email: string;
        passwordHash: string;
        isSuperAdmin: boolean;
        lastLoginAt: Date | null;
    }>;
}
//# sourceMappingURL=users.service.d.ts.map