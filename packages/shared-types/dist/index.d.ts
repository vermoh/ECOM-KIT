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
    validUntil?: string;
}
export interface SchemaField {
    id: string;
    orgId: string;
    schemaId: string;
    name: string;
    label: string;
    fieldType: 'text' | 'number' | 'boolean' | 'enum' | 'url';
    isRequired: boolean;
    allowedValues?: string[];
    description?: string;
    sortOrder: number;
}
export interface SEOGenerationTask {
    id: string;
    orgId: string;
    uploadId: string;
    runId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    lang: string;
    totalItems: number;
    processedItems: number;
    tokensUsed: number;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
}
export interface UploadJob {
    id: string;
    orgId: string;
    projectId: string;
    status: string;
    s3Key: string;
    originalFilename: string;
    rowCount?: number;
    includeSeo: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export interface TokenBudget {
    id: string;
    orgId: string;
    totalTokens: number;
    remainingTokens: number;
    resetAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface TokenUsageLog {
    id: string;
    orgId: string;
    serviceId?: string;
    jobId?: string;
    tokensUsed: number;
    model?: string;
    purpose: string;
    createdAt: Date;
}
//# sourceMappingURL=index.d.ts.map