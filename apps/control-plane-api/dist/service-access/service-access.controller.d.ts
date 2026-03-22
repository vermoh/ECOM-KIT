import { ServiceAccessService } from './service-access.service';
export declare class ServiceAccessController {
    private readonly serviceAccessService;
    constructor(serviceAccessService: ServiceAccessService);
    findAll(): Promise<{
        id: string;
        name: string;
        slug: string;
        status: "active" | "maintenance" | "deprecated";
        createdAt: Date;
        baseUrl: string;
        version: string;
    }[]>;
    grantAccess(serviceId: string, orgId: string, req: any): Promise<{
        id: string;
        createdAt: Date;
        orgId: string;
        validFrom: Date;
        validUntil: Date | null;
        serviceId: string;
        enabled: boolean;
        grantedBy: string;
    }>;
    createToken(serviceId: string, scopes: string[], req: any): Promise<{
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
//# sourceMappingURL=service-access.controller.d.ts.map