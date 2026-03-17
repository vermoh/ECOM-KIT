export interface AccessGrant {
    id: string;
    sourceService: string;
    targetService: string;
    orgId: string;
    permissions: string[];
    expiresAt: Date;
}
export interface UserSession {
    userId: string;
    orgId: string;
    roles: string[];
    permissions: string[];
    exp: number;
}
//# sourceMappingURL=index.d.ts.map