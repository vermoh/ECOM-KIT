import { pgTable, uuid, text, timestamp, integer, boolean, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const orgPlanEnum = pgEnum('org_plan', ['free', 'starter', 'pro', 'enterprise']);
export const orgStatusEnum = pgEnum('org_status', ['active', 'suspended', 'deleted']);
export const userStatusEnum = pgEnum('user_status', ['active', 'locked', 'pending', 'deleted']);
export const membershipStatusEnum = pgEnum('membership_status', ['active', 'invited', 'suspended', 'removed']);
export const serviceStatusEnum = pgEnum('service_status', ['active', 'maintenance', 'deprecated']);
export const uploadJobStatusEnum = pgEnum('upload_job_status', [
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

export const enrichmentRunStatusEnum = pgEnum('enrichment_run_status', ['queued', 'running', 'completed', 'failed']);
export const enrichedItemStatusEnum = pgEnum('enriched_item_status', ['ok', 'collision', 'manual_override']);
export const collisionStatusEnum = pgEnum('collision_status', ['detected', 'pending_review', 'resolved', 'dismissed']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  plan: orgPlanEnum('plan').default('free').notNull(),
  status: orgStatusEnum('status').default('active').notNull(),
  maxUsers: integer('max_users').default(5).notNull(),
  maxProjects: integer('max_projects').default(3).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  status: userStatusEnum('status').default('pending').notNull(),
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id), // null for system roles
  name: text('name').notNull(), // org_owner, org_admin, etc.
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  roleNameOrgIdx: uniqueIndex('role_name_org_idx').on(table.name, table.orgId),
}));

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  resource: text('resource').notNull(), // project, upload, schema, etc.
  action: text('action').notNull(), // create, read, update, delete, approve
  description: text('description'),
}, (table) => ({
  resourceActionIdx: uniqueIndex('resource_action_idx').on(table.resource, table.action),
}));

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  status: membershipStatusEnum('status').default('invited').notNull(),
  validFrom: timestamp('valid_from').defaultNow().notNull(),
  validUntil: timestamp('valid_until'),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgUserIdx: uniqueIndex('org_user_idx').on(table.orgId, table.userId),
}));

export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  version: text('version').notNull(),
  status: serviceStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const serviceAccess = pgTable('service_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  serviceId: uuid('service_id').notNull().references(() => services.id),
  enabled: boolean('enabled').default(true).notNull(),
  validFrom: timestamp('valid_from').defaultNow().notNull(),
  validUntil: timestamp('valid_until'),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgServiceIdx: uniqueIndex('org_service_idx').on(table.orgId, table.serviceId),
}));

export const accessGrants = pgTable('access_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  serviceId: uuid('service_id').notNull().references(() => services.id),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const uploadJobs = pgTable('upload_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  status: uploadJobStatusEnum('status').default('pending').notNull(),
  s3Key: text('s3_key').notNull(),
  originalFilename: text('original_filename').notNull(),
  rowCount: integer('row_count'),
  errorDetails: text('error_details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  actorType: text('actor_type').default('user').notNull(), // user, service, system
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: uuid('resource_id'),
  payload: text('payload'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const providerEnum = pgEnum('provider_type', ['openrouter', 'stripe', 'webhook']);

export const schemaTemplateStatusEnum = pgEnum('schema_template_status', ['draft', 'in_review', 'confirmed', 'rejected']);
export const schemaFieldTypeEnum = pgEnum('schema_field_type', ['text', 'number', 'boolean', 'enum', 'url']);
export const reviewTaskTypeEnum = pgEnum('review_task_type', ['schema_review', 'collision_review', 'seo_review']);
export const reviewTaskStatusEnum = pgEnum('review_task_status', ['pending', 'in_progress', 'completed', 'skipped']);

export const providerConfigs = pgTable('provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  provider: providerEnum('provider').notNull(),
  encryptedValue: text('encrypted_value').notNull(), // stored as base64 (iv:authTag:ciphertext)
  keyHint: text('key_hint').notNull(),
  rotatedAt: timestamp('rotated_at'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const schemaTemplates = pgTable('schema_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  jobId: uuid('job_id').notNull().references(() => uploadJobs.id),
  version: integer('version').default(1).notNull(),
  status: schemaTemplateStatusEnum('status').default('draft').notNull(),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  confirmedAt: timestamp('confirmed_at'),
  aiModel: text('ai_model').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const schemaFields = pgTable('schema_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  schemaId: uuid('schema_id').notNull().references(() => schemaTemplates.id),
  name: text('name').notNull(), // machine key (snake_case)
  label: text('label').notNull(), // display name
  fieldType: schemaFieldTypeEnum('field_type').default('text').notNull(),
  isRequired: boolean('is_required').default(false).notNull(),
  allowedValues: text('allowed_values').array(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
});

export const reviewTasks = pgTable('review_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  jobId: uuid('job_id').notNull().references(() => uploadJobs.id),
  taskType: reviewTaskTypeEnum('task_type').notNull(),
  status: reviewTaskStatusEnum('status').default('pending').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  completedBy: uuid('completed_by').references(() => users.id),
  dueAt: timestamp('due_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const enrichmentRuns = pgTable('enrichment_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  jobId: uuid('job_id').notNull().references(() => uploadJobs.id),
  schemaId: uuid('schema_id').notNull().references(() => schemaTemplates.id),
  status: enrichmentRunStatusEnum('status').default('queued').notNull(),
  totalItems: integer('total_items').default(0).notNull(),
  processedItems: integer('processed_items').default(0).notNull(),
  failedItems: integer('failed_items').default(0).notNull(),
  tokensUsed: integer('tokens_used').default(0).notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const enrichedItems = pgTable('enriched_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  runId: uuid('run_id').notNull().references(() => enrichmentRuns.id),
  skuExternalId: text('sku_external_id').notNull(),
  rawData: text('raw_data'), // JSON string or text
  enrichedData: text('enriched_data'), // JSON string `{field_name: value}`
  confidence: integer('confidence'), // 0-100
  status: enrichedItemStatusEnum('status').default('ok').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
});

export const collisions = pgTable('collisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  jobId: uuid('job_id').notNull().references(() => uploadJobs.id),
  enrichedItemId: uuid('enriched_item_id').notNull().references(() => enrichedItems.id),
  field: text('field').notNull(),
  originalValue: text('original_value'), // value from AI
  resolvedValue: text('resolved_value'), // value after human review
  reason: text('reason').notNull(), // 'low_confidence', 'missing_required', 'invalid_format'
  status: collisionStatusEnum('status').default('detected').notNull(),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


// Relations
export const uploadJobsRelations = relations(uploadJobs, ({ one, many }) => ({
  project: one(projects, {
    fields: [uploadJobs.projectId],
    references: [projects.id],
  }),
  schemaTemplates: many(schemaTemplates),
  reviewTasks: many(reviewTasks),
  collisions: many(collisions),
}));

export const schemaTemplatesRelations = relations(schemaTemplates, ({ one, many }) => ({
  job: one(uploadJobs, {
    fields: [schemaTemplates.jobId],
    references: [uploadJobs.id],
  }),
  fields: many(schemaFields),
}));

export const schemaFieldsRelations = relations(schemaFields, ({ one }) => ({
  template: one(schemaTemplates, {
    fields: [schemaFields.schemaId],
    references: [schemaTemplates.id],
  }),
}));

export const reviewTasksRelations = relations(reviewTasks, ({ one }) => ({
  job: one(uploadJobs, {
    fields: [reviewTasks.jobId],
    references: [uploadJobs.id],
  }),
}));

export const enrichmentRunsRelations = relations(enrichmentRuns, ({ one, many }) => ({
  job: one(uploadJobs, {
    fields: [enrichmentRuns.jobId],
    references: [uploadJobs.id],
  }),
  template: one(schemaTemplates, {
    fields: [enrichmentRuns.schemaId],
    references: [schemaTemplates.id],
  }),
  items: many(enrichedItems),
}));

export const enrichedItemsRelations = relations(enrichedItems, ({ one, many }) => ({
  run: one(enrichmentRuns, {
    fields: [enrichedItems.runId],
    references: [enrichmentRuns.id],
  }),
  collisions: many(collisions),
}));

export const collisionsRelations = relations(collisions, ({ one }) => ({
  job: one(uploadJobs, {
    fields: [collisions.jobId],
    references: [uploadJobs.id],
  }),
  item: one(enrichedItems, {
    fields: [collisions.enrichedItemId],
    references: [enrichedItems.id],
  }),
}));
