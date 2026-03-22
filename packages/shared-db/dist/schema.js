"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenUsageLogsRelations = exports.tokenBudgetsRelations = exports.exportJobsRelations = exports.collisionsRelations = exports.enrichedItemsRelations = exports.enrichmentRunsRelations = exports.reviewTasksRelations = exports.schemaFieldsRelations = exports.schemaTemplatesRelations = exports.seoTasksRelations = exports.uploadJobsRelations = exports.tokenUsageLogs = exports.tokenBudgets = exports.exportJobs = exports.collisions = exports.enrichedItems = exports.enrichmentRuns = exports.reviewTasks = exports.schemaFields = exports.schemaTemplates = exports.providerConfigs = exports.reviewTaskStatusEnum = exports.reviewTaskTypeEnum = exports.schemaFieldTypeEnum = exports.schemaTemplateStatusEnum = exports.providerEnum = exports.refreshTokens = exports.auditLogs = exports.seoTasks = exports.uploadJobs = exports.projects = exports.accessGrants = exports.serviceAccess = exports.services = exports.memberships = exports.rolePermissions = exports.permissions = exports.roles = exports.users = exports.organizations = exports.exportStatusEnum = exports.collisionStatusEnum = exports.enrichedItemStatusEnum = exports.enrichmentRunStatusEnum = exports.uploadJobStatusEnum = exports.serviceStatusEnum = exports.membershipStatusEnum = exports.userStatusEnum = exports.orgStatusEnum = exports.orgPlanEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
// Enums
exports.orgPlanEnum = (0, pg_core_1.pgEnum)('org_plan', ['free', 'starter', 'pro', 'enterprise']);
exports.orgStatusEnum = (0, pg_core_1.pgEnum)('org_status', ['active', 'suspended', 'deleted']);
exports.userStatusEnum = (0, pg_core_1.pgEnum)('user_status', ['active', 'locked', 'pending', 'deleted']);
exports.membershipStatusEnum = (0, pg_core_1.pgEnum)('membership_status', ['active', 'invited', 'suspended', 'removed']);
exports.serviceStatusEnum = (0, pg_core_1.pgEnum)('service_status', ['active', 'maintenance', 'deprecated']);
exports.uploadJobStatusEnum = (0, pg_core_1.pgEnum)('upload_job_status', [
    'pending',
    'parsing',
    'parsed',
    'schema_draft',
    'schema_review',
    'schema_confirmed',
    'enriching',
    'enriched',
    'needs_collision_review',
    'ready',
    'exporting',
    'done',
    'failed'
]);
exports.enrichmentRunStatusEnum = (0, pg_core_1.pgEnum)('enrichment_run_status', ['queued', 'running', 'completed', 'failed']);
exports.enrichedItemStatusEnum = (0, pg_core_1.pgEnum)('enriched_item_status', ['ok', 'collision', 'manual_override']);
exports.collisionStatusEnum = (0, pg_core_1.pgEnum)('collision_status', ['detected', 'pending_review', 'resolved', 'dismissed']);
exports.exportStatusEnum = (0, pg_core_1.pgEnum)('export_status', ['queued', 'generating', 'ready', 'expired', 'failed']);
exports.organizations = (0, pg_core_1.pgTable)('organizations', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    slug: (0, pg_core_1.text)('slug').notNull().unique(),
    name: (0, pg_core_1.text)('name').notNull(),
    plan: (0, exports.orgPlanEnum)('plan').default('free').notNull(),
    status: (0, exports.orgStatusEnum)('status').default('active').notNull(),
    maxUsers: (0, pg_core_1.integer)('max_users').default(5).notNull(),
    maxProjects: (0, pg_core_1.integer)('max_projects').default(3).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at'),
    billingCustomerId: (0, pg_core_1.text)('billing_customer_id'),
    subscriptionId: (0, pg_core_1.text)('subscription_id'),
});
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    passwordHash: (0, pg_core_1.text)('password_hash').notNull(),
    status: (0, exports.userStatusEnum)('status').default('pending').notNull(),
    isSuperAdmin: (0, pg_core_1.boolean)('is_super_admin').default(false).notNull(),
    lastLoginAt: (0, pg_core_1.timestamp)('last_login_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at'),
});
exports.roles = (0, pg_core_1.pgTable)('roles', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').references(() => exports.organizations.id), // null for system roles
    name: (0, pg_core_1.text)('name').notNull(), // org_owner, org_admin, etc.
    description: (0, pg_core_1.text)('description'),
    isSystem: (0, pg_core_1.boolean)('is_system').default(false).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => ({
    roleNameOrgIdx: (0, pg_core_1.uniqueIndex)('role_name_org_idx').on(table.name, table.orgId),
}));
exports.permissions = (0, pg_core_1.pgTable)('permissions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    resource: (0, pg_core_1.text)('resource').notNull(), // project, upload, schema, etc.
    action: (0, pg_core_1.text)('action').notNull(), // create, read, update, delete, approve
    description: (0, pg_core_1.text)('description'),
}, (table) => ({
    resourceActionIdx: (0, pg_core_1.uniqueIndex)('resource_action_idx').on(table.resource, table.action),
}));
exports.rolePermissions = (0, pg_core_1.pgTable)('role_permissions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    roleId: (0, pg_core_1.uuid)('role_id').notNull().references(() => exports.roles.id),
    permissionId: (0, pg_core_1.uuid)('permission_id').notNull().references(() => exports.permissions.id),
});
exports.memberships = (0, pg_core_1.pgTable)('memberships', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    userId: (0, pg_core_1.uuid)('user_id').notNull().references(() => exports.users.id),
    roleId: (0, pg_core_1.uuid)('role_id').notNull().references(() => exports.roles.id),
    status: (0, exports.membershipStatusEnum)('status').default('invited').notNull(),
    validFrom: (0, pg_core_1.timestamp)('valid_from').defaultNow().notNull(),
    validUntil: (0, pg_core_1.timestamp)('valid_until'),
    invitedBy: (0, pg_core_1.uuid)('invited_by').references(() => exports.users.id),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => ({
    orgUserIdx: (0, pg_core_1.uniqueIndex)('org_user_idx').on(table.orgId, table.userId),
}));
exports.services = (0, pg_core_1.pgTable)('services', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    slug: (0, pg_core_1.text)('slug').notNull().unique(),
    name: (0, pg_core_1.text)('name').notNull(),
    baseUrl: (0, pg_core_1.text)('base_url').notNull(),
    version: (0, pg_core_1.text)('version').notNull(),
    status: (0, exports.serviceStatusEnum)('status').default('active').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.serviceAccess = (0, pg_core_1.pgTable)('service_access', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    serviceId: (0, pg_core_1.uuid)('service_id').notNull().references(() => exports.services.id),
    enabled: (0, pg_core_1.boolean)('enabled').default(true).notNull(),
    validFrom: (0, pg_core_1.timestamp)('valid_from').defaultNow().notNull(),
    validUntil: (0, pg_core_1.timestamp)('valid_until'),
    grantedBy: (0, pg_core_1.uuid)('granted_by').notNull().references(() => exports.users.id),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => ({
    orgServiceIdx: (0, pg_core_1.uniqueIndex)('org_service_idx').on(table.orgId, table.serviceId),
}));
exports.accessGrants = (0, pg_core_1.pgTable)('access_grants', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    serviceId: (0, pg_core_1.uuid)('service_id').notNull().references(() => exports.services.id),
    tokenHash: (0, pg_core_1.text)('token_hash').notNull(),
    scopes: (0, pg_core_1.text)('scopes').array().notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
    revokedAt: (0, pg_core_1.timestamp)('revoked_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.projects = (0, pg_core_1.pgTable)('projects', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    name: (0, pg_core_1.text)('name').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
exports.uploadJobs = (0, pg_core_1.pgTable)('upload_jobs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    projectId: (0, pg_core_1.uuid)('project_id').notNull().references(() => exports.projects.id),
    status: (0, exports.uploadJobStatusEnum)('status').default('pending').notNull(),
    s3Key: (0, pg_core_1.text)('s3_key').notNull(),
    originalFilename: (0, pg_core_1.text)('original_filename').notNull(),
    rowCount: (0, pg_core_1.integer)('row_count'),
    includeSeo: (0, pg_core_1.boolean)('include_seo').default(false).notNull(),
    errorDetails: (0, pg_core_1.text)('error_details'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
exports.seoTasks = (0, pg_core_1.pgTable)('seo_tasks', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    uploadId: (0, pg_core_1.uuid)('upload_id').notNull().references(() => exports.uploadJobs.id, { onDelete: 'cascade' }),
    runId: (0, pg_core_1.uuid)('run_id').notNull().references(() => exports.enrichmentRuns.id),
    status: (0, exports.enrichmentRunStatusEnum)('status').default('queued').notNull(),
    lang: (0, pg_core_1.text)('lang').default('ru').notNull(),
    totalItems: (0, pg_core_1.integer)('total_items').default(0),
    processedItems: (0, pg_core_1.integer)('processed_items').default(0).notNull(),
    tokensUsed: (0, pg_core_1.integer)('tokens_used').default(0).notNull(),
    startedAt: (0, pg_core_1.timestamp)('started_at'),
    completedAt: (0, pg_core_1.timestamp)('completed_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.auditLogs = (0, pg_core_1.pgTable)('audit_logs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').references(() => exports.organizations.id),
    userId: (0, pg_core_1.uuid)('user_id').references(() => exports.users.id),
    actorType: (0, pg_core_1.text)('actor_type').default('user').notNull(), // user, service, system
    action: (0, pg_core_1.text)('action').notNull(),
    resourceType: (0, pg_core_1.text)('resource_type'),
    resourceId: (0, pg_core_1.uuid)('resource_id'),
    payload: (0, pg_core_1.text)('payload'),
    ipAddress: (0, pg_core_1.text)('ip_address'),
    userAgent: (0, pg_core_1.text)('user_agent'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.refreshTokens = (0, pg_core_1.pgTable)('refresh_tokens', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id').notNull().references(() => exports.users.id),
    token: (0, pg_core_1.text)('token').notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
    revokedAt: (0, pg_core_1.timestamp)('revoked_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.providerEnum = (0, pg_core_1.pgEnum)('provider_type', ['openrouter', 'stripe', 'webhook']);
exports.schemaTemplateStatusEnum = (0, pg_core_1.pgEnum)('schema_template_status', ['draft', 'in_review', 'confirmed', 'rejected']);
exports.schemaFieldTypeEnum = (0, pg_core_1.pgEnum)('schema_field_type', ['text', 'number', 'boolean', 'enum', 'url']);
exports.reviewTaskTypeEnum = (0, pg_core_1.pgEnum)('review_task_type', ['schema_review', 'collision_review', 'seo_review']);
exports.reviewTaskStatusEnum = (0, pg_core_1.pgEnum)('review_task_status', ['pending', 'in_progress', 'completed', 'skipped']);
exports.providerConfigs = (0, pg_core_1.pgTable)('provider_configs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    provider: (0, exports.providerEnum)('provider').notNull(),
    encryptedValue: (0, pg_core_1.text)('encrypted_value').notNull(), // stored as base64 (iv:authTag:ciphertext)
    keyHint: (0, pg_core_1.text)('key_hint').notNull(),
    rotatedAt: (0, pg_core_1.timestamp)('rotated_at'),
    createdBy: (0, pg_core_1.uuid)('created_by').notNull().references(() => exports.users.id),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.schemaTemplates = (0, pg_core_1.pgTable)('schema_templates', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    jobId: (0, pg_core_1.uuid)('job_id').notNull().references(() => exports.uploadJobs.id),
    version: (0, pg_core_1.integer)('version').default(1).notNull(),
    status: (0, exports.schemaTemplateStatusEnum)('status').default('draft').notNull(),
    confirmedBy: (0, pg_core_1.uuid)('confirmed_by').references(() => exports.users.id),
    confirmedAt: (0, pg_core_1.timestamp)('confirmed_at'),
    aiModel: (0, pg_core_1.text)('ai_model').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.schemaFields = (0, pg_core_1.pgTable)('schema_fields', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    schemaId: (0, pg_core_1.uuid)('schema_id').notNull().references(() => exports.schemaTemplates.id),
    name: (0, pg_core_1.text)('name').notNull(), // machine key (snake_case)
    label: (0, pg_core_1.text)('label').notNull(), // display name
    fieldType: (0, exports.schemaFieldTypeEnum)('field_type').default('text').notNull(),
    isRequired: (0, pg_core_1.boolean)('is_required').default(false).notNull(),
    allowedValues: (0, pg_core_1.text)('allowed_values').array(),
    description: (0, pg_core_1.text)('description'),
    sortOrder: (0, pg_core_1.integer)('sort_order').default(0).notNull(),
});
exports.reviewTasks = (0, pg_core_1.pgTable)('review_tasks', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    jobId: (0, pg_core_1.uuid)('job_id').notNull().references(() => exports.uploadJobs.id),
    taskType: (0, exports.reviewTaskTypeEnum)('task_type').notNull(),
    status: (0, exports.reviewTaskStatusEnum)('status').default('pending').notNull(),
    assignedTo: (0, pg_core_1.uuid)('assigned_to').references(() => exports.users.id),
    completedBy: (0, pg_core_1.uuid)('completed_by').references(() => exports.users.id),
    dueAt: (0, pg_core_1.timestamp)('due_at'),
    completedAt: (0, pg_core_1.timestamp)('completed_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.enrichmentRuns = (0, pg_core_1.pgTable)('enrichment_runs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    jobId: (0, pg_core_1.uuid)('job_id').notNull().references(() => exports.uploadJobs.id),
    schemaId: (0, pg_core_1.uuid)('schema_id').notNull().references(() => exports.schemaTemplates.id),
    status: (0, exports.enrichmentRunStatusEnum)('status').default('queued').notNull(),
    totalItems: (0, pg_core_1.integer)('total_items').default(0).notNull(),
    processedItems: (0, pg_core_1.integer)('processed_items').default(0).notNull(),
    failedItems: (0, pg_core_1.integer)('failed_items').default(0).notNull(),
    tokensUsed: (0, pg_core_1.integer)('tokens_used').default(0).notNull(),
    startedAt: (0, pg_core_1.timestamp)('started_at'),
    completedAt: (0, pg_core_1.timestamp)('completed_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.enrichedItems = (0, pg_core_1.pgTable)('enriched_items', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    runId: (0, pg_core_1.uuid)('run_id').notNull().references(() => exports.enrichmentRuns.id),
    uploadId: (0, pg_core_1.uuid)('upload_id').notNull().references(() => exports.uploadJobs.id),
    skuExternalId: (0, pg_core_1.text)('sku_external_id').notNull(),
    rawData: (0, pg_core_1.text)('raw_data'), // JSON string or text
    enrichedData: (0, pg_core_1.text)('enriched_data'), // JSON string `{field_name: value}`
    confidence: (0, pg_core_1.integer)('confidence'), // 0-100
    status: (0, exports.enrichedItemStatusEnum)('status').default('ok').notNull(),
    reviewedBy: (0, pg_core_1.uuid)('reviewed_by').references(() => exports.users.id),
    reviewedAt: (0, pg_core_1.timestamp)('reviewed_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
exports.collisions = (0, pg_core_1.pgTable)('collisions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    jobId: (0, pg_core_1.uuid)('job_id').notNull().references(() => exports.uploadJobs.id),
    enrichedItemId: (0, pg_core_1.uuid)('enriched_item_id').notNull().references(() => exports.enrichedItems.id),
    field: (0, pg_core_1.text)('field').notNull(),
    originalValue: (0, pg_core_1.text)('original_value'), // value from AI
    resolvedValue: (0, pg_core_1.text)('resolved_value'), // value after human review
    reason: (0, pg_core_1.text)('reason').notNull(), // 'low_confidence', 'missing_required', 'invalid_format'
    status: (0, exports.collisionStatusEnum)('status').default('detected').notNull(),
    resolvedBy: (0, pg_core_1.uuid)('resolved_by').references(() => exports.users.id),
    resolvedAt: (0, pg_core_1.timestamp)('resolved_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
exports.exportJobs = (0, pg_core_1.pgTable)('export_jobs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    uploadId: (0, pg_core_1.uuid)('upload_id').notNull().references(() => exports.uploadJobs.id),
    requestedBy: (0, pg_core_1.uuid)('requested_by').notNull().references(() => exports.users.id),
    status: (0, exports.exportStatusEnum)('status').default('queued').notNull(),
    s3Key: (0, pg_core_1.text)('s3_key'),
    signedUrl: (0, pg_core_1.text)('signed_url'),
    urlExpiresAt: (0, pg_core_1.timestamp)('url_expires_at'),
    includeSeo: (0, pg_core_1.boolean)('include_seo').default(false).notNull(),
    errorMessage: (0, pg_core_1.text)('error_message'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    completedAt: (0, pg_core_1.timestamp)('completed_at'),
});
exports.tokenBudgets = (0, pg_core_1.pgTable)('token_budgets', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    totalTokens: (0, pg_core_1.integer)('total_tokens').notNull().default(100000),
    remainingTokens: (0, pg_core_1.integer)('remaining_tokens').notNull().default(100000),
    resetAt: (0, pg_core_1.timestamp)('reset_at'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
}, (table) => ({
    orgBudgetIdx: (0, pg_core_1.uniqueIndex)('org_budget_idx').on(table.orgId),
}));
exports.tokenUsageLogs = (0, pg_core_1.pgTable)('token_usage_logs', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    orgId: (0, pg_core_1.uuid)('org_id').notNull().references(() => exports.organizations.id),
    serviceId: (0, pg_core_1.uuid)('service_id').references(() => exports.services.id),
    jobId: (0, pg_core_1.uuid)('job_id'),
    tokensUsed: (0, pg_core_1.integer)('tokens_used').notNull(),
    model: (0, pg_core_1.text)('model'),
    purpose: (0, pg_core_1.text)('purpose').notNull(), // enrichment, seo, schema_generation
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
// Relations
exports.uploadJobsRelations = (0, drizzle_orm_1.relations)(exports.uploadJobs, ({ one, many }) => ({
    project: one(exports.projects, {
        fields: [exports.uploadJobs.projectId],
        references: [exports.projects.id],
    }),
    schemaTemplates: many(exports.schemaTemplates),
    reviewTasks: many(exports.reviewTasks),
    collisions: many(exports.collisions),
    exports: many(exports.exportJobs),
    seoTasks: many(exports.seoTasks),
}));
exports.seoTasksRelations = (0, drizzle_orm_1.relations)(exports.seoTasks, ({ one }) => ({
    upload: one(exports.uploadJobs, {
        fields: [exports.seoTasks.uploadId],
        references: [exports.uploadJobs.id],
    }),
    run: one(exports.enrichmentRuns, {
        fields: [exports.seoTasks.runId],
        references: [exports.enrichmentRuns.id],
    }),
}));
exports.schemaTemplatesRelations = (0, drizzle_orm_1.relations)(exports.schemaTemplates, ({ one, many }) => ({
    job: one(exports.uploadJobs, {
        fields: [exports.schemaTemplates.jobId],
        references: [exports.uploadJobs.id],
    }),
    fields: many(exports.schemaFields),
}));
exports.schemaFieldsRelations = (0, drizzle_orm_1.relations)(exports.schemaFields, ({ one }) => ({
    template: one(exports.schemaTemplates, {
        fields: [exports.schemaFields.schemaId],
        references: [exports.schemaTemplates.id],
    }),
}));
exports.reviewTasksRelations = (0, drizzle_orm_1.relations)(exports.reviewTasks, ({ one }) => ({
    job: one(exports.uploadJobs, {
        fields: [exports.reviewTasks.jobId],
        references: [exports.uploadJobs.id],
    }),
}));
exports.enrichmentRunsRelations = (0, drizzle_orm_1.relations)(exports.enrichmentRuns, ({ one, many }) => ({
    job: one(exports.uploadJobs, {
        fields: [exports.enrichmentRuns.jobId],
        references: [exports.uploadJobs.id],
    }),
    template: one(exports.schemaTemplates, {
        fields: [exports.enrichmentRuns.schemaId],
        references: [exports.schemaTemplates.id],
    }),
    items: many(exports.enrichedItems),
}));
exports.enrichedItemsRelations = (0, drizzle_orm_1.relations)(exports.enrichedItems, ({ one, many }) => ({
    run: one(exports.enrichmentRuns, {
        fields: [exports.enrichedItems.runId],
        references: [exports.enrichmentRuns.id],
    }),
    collisions: many(exports.collisions),
}));
exports.collisionsRelations = (0, drizzle_orm_1.relations)(exports.collisions, ({ one }) => ({
    job: one(exports.uploadJobs, {
        fields: [exports.collisions.jobId],
        references: [exports.uploadJobs.id],
    }),
    item: one(exports.enrichedItems, {
        fields: [exports.collisions.enrichedItemId],
        references: [exports.enrichedItems.id],
    }),
}));
exports.exportJobsRelations = (0, drizzle_orm_1.relations)(exports.exportJobs, ({ one }) => ({
    org: one(exports.organizations, {
        fields: [exports.exportJobs.orgId],
        references: [exports.organizations.id],
    }),
    upload: one(exports.uploadJobs, {
        fields: [exports.exportJobs.uploadId],
        references: [exports.uploadJobs.id],
    }),
    user: one(exports.users, {
        fields: [exports.exportJobs.requestedBy],
        references: [exports.users.id],
    }),
}));
exports.tokenBudgetsRelations = (0, drizzle_orm_1.relations)(exports.tokenBudgets, ({ one }) => ({
    org: one(exports.organizations, {
        fields: [exports.tokenBudgets.orgId],
        references: [exports.organizations.id],
    }),
}));
exports.tokenUsageLogsRelations = (0, drizzle_orm_1.relations)(exports.tokenUsageLogs, ({ one }) => ({
    org: one(exports.organizations, {
        fields: [exports.tokenUsageLogs.orgId],
        references: [exports.organizations.id],
    }),
    service: one(exports.services, {
        fields: [exports.tokenUsageLogs.serviceId],
        references: [exports.services.id],
    }),
}));
//# sourceMappingURL=schema.js.map