import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
export declare class OrganizationsService {
    private readonly db;
    constructor(db: PostgresJsDatabase<typeof schema>);
    findAll(): Promise<{
        id: string;
        name: string;
        slug: string;
        plan: "free" | "starter" | "pro" | "enterprise";
        status: "active" | "suspended" | "deleted";
        maxUsers: number;
        maxProjects: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        billingCustomerId: string | null;
        subscriptionId: string | null;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        name: string;
        slug: string;
        plan: "free" | "starter" | "pro" | "enterprise";
        status: "active" | "suspended" | "deleted";
        maxUsers: number;
        maxProjects: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        billingCustomerId: string | null;
        subscriptionId: string | null;
    }>;
    create(data: typeof schema.organizations.$inferInsert): Promise<{
        id: string;
        name: string;
        slug: string;
        plan: "free" | "starter" | "pro" | "enterprise";
        status: "active" | "suspended" | "deleted";
        maxUsers: number;
        maxProjects: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        billingCustomerId: string | null;
        subscriptionId: string | null;
    }>;
    update(id: string, data: Partial<typeof schema.organizations.$inferInsert>): Promise<{
        id: string;
        name: string;
        slug: string;
        plan: "free" | "starter" | "pro" | "enterprise";
        status: "active" | "suspended" | "deleted";
        maxUsers: number;
        maxProjects: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        billingCustomerId: string | null;
        subscriptionId: string | null;
    }>;
}
//# sourceMappingURL=organizations.service.d.ts.map