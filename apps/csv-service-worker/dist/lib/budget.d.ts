export declare function checkBudget(orgId: string, requiredTokens: number): Promise<boolean>;
export declare function consumeBudget(data: {
    orgId: string;
    serviceId?: string;
    jobId?: string;
    tokensUsed: number;
    model: string;
    purpose: string;
}): Promise<void>;
//# sourceMappingURL=budget.d.ts.map