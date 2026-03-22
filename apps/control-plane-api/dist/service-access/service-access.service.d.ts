import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ecom-kit/shared-db';
export declare class ServiceAccessService {
    private readonly db;
    constructor(db: PostgresJsDatabase<typeof schema>);
    findAllServices(): Promise<{
        id: string;
        name: string;
        slug: string;
        status: "active" | "maintenance" | "deprecated";
        createdAt: Date;
        baseUrl: string;
        version: string;
    }[]>;
    grantAccess(orgId: string, serviceId: string, grantedBy: string): Promise<{
        id: string;
        createdAt: Date;
        orgId: string;
        validFrom: Date;
        validUntil: Date | null;
        serviceId: string;
        enabled: boolean;
        grantedBy: string;
    }>;
    createAccessGrant(orgId: string, serviceId: string, scopes: string[]): Promise<{
        token: string;
        id: string;
        createdAt: Date;
        orgId: string;
        serviceId: string;
        tokenHash: string;
        scopes: string[];
        expiresAt: Date;
        revokedAt: Date | null;
    }>;
}
//# sourceMappingURL=service-access.service.d.ts.map