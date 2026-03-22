import { OrganizationsService } from './organizations.service';
export declare class OrganizationsController {
    private readonly organizationsService;
    constructor(organizationsService: OrganizationsService);
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
    create(createOrgDto: any): Promise<{
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
    update(id: string, updateOrgDto: any): Promise<{
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
//# sourceMappingURL=organizations.controller.d.ts.map