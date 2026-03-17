-- =============================================================================
-- ECOM KIT Platform — Initial Schema Migration
-- Version  : 001
-- Date     : 2026-03-17
-- Databases: control_plane (cp) | csv_service (csv_svc)
-- =============================================================================
-- USAGE:
--   Control Plane:  psql -d control_plane  -f 001_initial_schema.sql
--   CSV Service:    psql -d csv_service    -f 001_initial_schema.sql
-- Both schemas are in a single file, separated by \connect or run per-DB.
-- Comment out the relevant section when running against each database.
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1: CONTROL PLANE DATABASE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive TEXT (email)

-- ---------------------------------------------------------------------------
-- ENUM Types — Control Plane
-- ---------------------------------------------------------------------------

CREATE TYPE org_status      AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE org_plan        AS ENUM ('free', 'starter', 'pro', 'enterprise');
CREATE TYPE user_status     AS ENUM ('pending', 'active', 'locked', 'deleted');
CREATE TYPE membership_status AS ENUM ('invited', 'active', 'suspended', 'removed');
CREATE TYPE service_status  AS ENUM ('active', 'maintenance', 'deprecated');
CREATE TYPE provider_type   AS ENUM ('openrouter', 'stripe', 'webhook', 'custom');
CREATE TYPE actor_type      AS ENUM ('user', 'service', 'system');

-- ---------------------------------------------------------------------------
-- TABLE: organizations
-- Root tenant entity. Every tenant maps to exactly one organization.
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
    id           UUID          NOT NULL DEFAULT gen_random_uuid(),
    slug         TEXT          NOT NULL,
    name         TEXT          NOT NULL,
    plan         org_plan      NOT NULL DEFAULT 'free',
    status       org_status    NOT NULL DEFAULT 'active',
    max_users    INTEGER       NOT NULL DEFAULT 5,
    max_projects INTEGER       NOT NULL DEFAULT 3,
    metadata     JSONB         NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ   NULL,

    CONSTRAINT organizations_pkey PRIMARY KEY (id),
    CONSTRAINT organizations_slug_length CHECK (char_length(slug) BETWEEN 3 AND 63),
    CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'),
    CONSTRAINT organizations_max_users_positive CHECK (max_users > 0),
    CONSTRAINT organizations_max_projects_positive CHECK (max_projects > 0)
);

COMMENT ON TABLE  organizations              IS 'Root tenant entity. One row = one SaaS customer.';
COMMENT ON COLUMN organizations.slug         IS 'URL-safe unique identifier for the org (e.g. acme-corp).';
COMMENT ON COLUMN organizations.metadata     IS 'Extensible key-value store for plan-specific config.';
COMMENT ON COLUMN organizations.deleted_at   IS 'Soft-delete timestamp. NULL means the record is live.';

-- Unique slug among non-deleted orgs
CREATE UNIQUE INDEX uq_organizations_slug
    ON organizations (slug)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_organizations_status  ON organizations (status);
CREATE INDEX idx_organizations_plan    ON organizations (plan);

-- ---------------------------------------------------------------------------
-- TABLE: users
-- Global user account. A user can belong to multiple organizations.
-- Credentials are NEVER returned in API responses.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    email            CITEXT       NOT NULL,
    password_hash    TEXT         NOT NULL,
    mfa_secret_enc   BYTEA        NULL,                       -- AES-256-GCM, key in Vault
    mfa_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
    status           user_status  NOT NULL DEFAULT 'pending',
    last_login_at    TIMESTAMPTZ  NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ  NULL,

    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_format CHECK (email ~ '^[^@]+@[^@]+\.[^@]+$')
);

COMMENT ON TABLE  users                 IS 'Platform-wide user accounts. Credentials excluded from all API responses.';
COMMENT ON COLUMN users.email           IS 'Case-insensitive unique email via CITEXT.';
COMMENT ON COLUMN users.password_hash   IS 'argon2id hash. Never serialised.';
COMMENT ON COLUMN users.mfa_secret_enc  IS 'AES-256-GCM blob. Encryption key managed in Vault. Never serialised.';

CREATE UNIQUE INDEX uq_users_email
    ON users (email)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_users_status      ON users (status);
CREATE INDEX idx_users_deleted_at  ON users (deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TABLE: roles
-- Named permission set scoped to an org (org_id NOT NULL)
-- or a global system role (org_id IS NULL, is_system = TRUE).
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    org_id      UUID        NULL      REFERENCES organizations (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT        NULL,
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT roles_pkey PRIMARY KEY (id),
    CONSTRAINT roles_system_no_org CHECK (
        (is_system = TRUE  AND org_id IS NULL) OR
        (is_system = FALSE AND org_id IS NOT NULL)
    )
);

COMMENT ON TABLE  roles           IS 'Named permission sets. System roles are immutable and global.';
COMMENT ON COLUMN roles.is_system IS 'System roles cannot be edited or deleted.';

-- Unique name per org
CREATE UNIQUE INDEX uq_roles_org_name
    ON roles (org_id, name)
    WHERE org_id IS NOT NULL;

-- Unique name for system roles
CREATE UNIQUE INDEX uq_roles_system_name
    ON roles (name)
    WHERE org_id IS NULL AND is_system = TRUE;

CREATE INDEX idx_roles_org_id ON roles (org_id);

-- ---------------------------------------------------------------------------
-- TABLE: permissions
-- Atomic resource:action pairs. Managed only via deployment (read-only at runtime).
-- ---------------------------------------------------------------------------
CREATE TABLE permissions (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    resource    TEXT NOT NULL,
    action      TEXT NOT NULL,
    description TEXT NULL,

    CONSTRAINT permissions_pkey PRIMARY KEY (id),
    CONSTRAINT permissions_resource_not_empty CHECK (char_length(resource) > 0),
    CONSTRAINT permissions_action_not_empty   CHECK (char_length(action)   > 0)
);

COMMENT ON TABLE permissions IS 'Atomic RBAC permissions (resource:action). Insert-only via deployment.';

CREATE UNIQUE INDEX uq_permissions_resource_action ON permissions (resource, action);

-- ---------------------------------------------------------------------------
-- TABLE: role_permissions  (junction)
-- ---------------------------------------------------------------------------
CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles       (id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,

    CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_permission_id ON role_permissions (permission_id);

-- ---------------------------------------------------------------------------
-- TABLE: memberships
-- Links a User to an Organization with a Role and optional time window.
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
    id          UUID              NOT NULL DEFAULT gen_random_uuid(),
    org_id      UUID              NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    user_id     UUID              NOT NULL REFERENCES users         (id) ON DELETE RESTRICT,
    role_id     UUID              NOT NULL REFERENCES roles         (id) ON DELETE RESTRICT,
    status      membership_status NOT NULL DEFAULT 'invited',
    invited_by  UUID              NULL     REFERENCES users         (id) ON DELETE SET NULL,
    valid_from  TIMESTAMPTZ       NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ       NULL,                             -- NULL = no expiry
    created_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),

    CONSTRAINT memberships_pkey                   PRIMARY KEY (id),
    CONSTRAINT memberships_valid_window           CHECK (valid_until IS NULL OR valid_until > valid_from)
);

COMMENT ON TABLE  memberships             IS 'User-to-Org binding with role and optional access window.';
COMMENT ON COLUMN memberships.valid_until IS 'NULL = unlimited. Checked on every authenticated request.';

-- One active membership per (org, user)
CREATE UNIQUE INDEX uq_memberships_org_user_active
    ON memberships (org_id, user_id)
    WHERE status <> 'removed';

CREATE INDEX idx_memberships_user_id        ON memberships (user_id);
CREATE INDEX idx_memberships_org_status     ON memberships (org_id, status);
CREATE INDEX idx_memberships_valid_until    ON memberships (valid_until)
    WHERE valid_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TABLE: service_registry
-- Catalogue of Service Plane monoliths known to the Control Plane.
-- base_url is internal and MUST NOT appear in any API response.
-- ---------------------------------------------------------------------------
CREATE TABLE service_registry (
    id         UUID           NOT NULL DEFAULT gen_random_uuid(),
    slug       TEXT           NOT NULL,
    name       TEXT           NOT NULL,
    base_url   TEXT           NOT NULL,     -- internal; excluded from API responses
    version    TEXT           NOT NULL,
    status     service_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT service_registry_pkey         PRIMARY KEY (id),
    CONSTRAINT service_registry_slug_format  CHECK (slug ~ '^[a-z0-9\-]+$'),
    CONSTRAINT service_registry_version_semver CHECK (version ~ '^\d+\.\d+\.\d+$')
);

COMMENT ON TABLE  service_registry          IS 'Registry of Service Plane monoliths.';
COMMENT ON COLUMN service_registry.base_url IS 'Internal service URL. NEVER exposed in API responses.';

CREATE UNIQUE INDEX uq_service_registry_slug ON service_registry (slug);
CREATE INDEX idx_service_registry_status     ON service_registry (status);

-- ---------------------------------------------------------------------------
-- TABLE: service_access
-- Controls which organizations can access which services, with time window.
-- Only super_admin may INSERT / UPDATE.
-- ---------------------------------------------------------------------------
CREATE TABLE service_access (
    id         UUID        NOT NULL DEFAULT gen_random_uuid(),
    org_id     UUID        NOT NULL REFERENCES organizations   (id) ON DELETE CASCADE,
    service_id UUID        NOT NULL REFERENCES service_registry(id) ON DELETE RESTRICT,
    enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ NULL,
    granted_by UUID        NOT NULL REFERENCES users           (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT service_access_pkey         PRIMARY KEY (id),
    CONSTRAINT service_access_valid_window CHECK (valid_until IS NULL OR valid_until > valid_from)
);

COMMENT ON TABLE service_access IS 'Org-to-Service access grants. super_admin only. Checked on every service request.';

CREATE UNIQUE INDEX uq_service_access_org_service ON service_access (org_id, service_id);
CREATE INDEX idx_service_access_org_enabled       ON service_access (org_id, enabled);
CREATE INDEX idx_service_access_valid_until       ON service_access (valid_until)
    WHERE valid_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TABLE: provider_configs
-- Encrypted external provider credentials (OpenRouter key, Stripe, etc.).
-- encrypted_value MUST NEVER be serialised in API responses or audit payloads.
-- ---------------------------------------------------------------------------
CREATE TABLE provider_configs (
    id              UUID          NOT NULL DEFAULT gen_random_uuid(),
    org_id          UUID          NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    provider        provider_type NOT NULL,
    encrypted_value BYTEA         NOT NULL,   -- AES-256-GCM; key managed in Vault
    key_hint        TEXT          NOT NULL,   -- last 4 chars for UI display only
    rotated_at      TIMESTAMPTZ   NULL,
    created_by      UUID          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT provider_configs_pkey          PRIMARY KEY (id),
    CONSTRAINT provider_configs_hint_length   CHECK (char_length(key_hint) BETWEEN 2 AND 8)
);

COMMENT ON TABLE  provider_configs                 IS 'Encrypted provider credentials. Decrypted only in AI Gateway. org_owner only.';
COMMENT ON COLUMN provider_configs.encrypted_value IS 'AES-256-GCM blob. Vault manages the encryption key. NEVER serialised.';
COMMENT ON COLUMN provider_configs.key_hint        IS 'Last 4 characters of the raw key — safe for UI display.';

CREATE UNIQUE INDEX uq_provider_configs_org_provider ON provider_configs (org_id, provider);
CREATE INDEX idx_provider_configs_org_id             ON provider_configs (org_id);

-- ---------------------------------------------------------------------------
-- TABLE: audit_logs
-- Immutable append-only activity log. No UPDATE, no DELETE, no deleted_at.
-- Application DB user has INSERT privileges only on this table.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    org_id        UUID        NULL,       -- NULL for super_admin platform actions
    actor_id      UUID        NULL,       -- NULL for system/automated actions
    actor_type    actor_type  NOT NULL,
    action        TEXT        NOT NULL,   -- e.g. 'user.login', 'job.created'
    resource_type TEXT        NULL,
    resource_id   UUID        NULL,
    payload       JSONB       NOT NULL DEFAULT '{}',
    ip_address    INET        NULL,
    user_agent    TEXT        NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),   -- immutable

    CONSTRAINT audit_logs_pkey             PRIMARY KEY (id),
    CONSTRAINT audit_logs_action_not_empty CHECK (char_length(action) > 0),
    CONSTRAINT audit_logs_no_secrets       CHECK (
        payload NOT LIKE '%password%'   AND
        payload NOT LIKE '%secret%'     AND
        payload NOT LIKE '%token%'
    )
);

COMMENT ON TABLE  audit_logs            IS 'Append-only audit trail. DB role has INSERT-only privilege on this table.';
COMMENT ON COLUMN audit_logs.payload    IS 'Context JSON. MUST NOT contain passwords, secrets, or tokens.';
COMMENT ON COLUMN audit_logs.created_at IS 'Immutable. Never updated.';

-- Primary query pattern: org audit feed by time
CREATE INDEX idx_audit_logs_org_created     ON audit_logs (org_id, created_at DESC)
    WHERE org_id IS NOT NULL;

CREATE INDEX idx_audit_logs_actor_id        ON audit_logs (actor_id)
    WHERE actor_id IS NOT NULL;

CREATE INDEX idx_audit_logs_resource        ON audit_logs (resource_type, resource_id)
    WHERE resource_type IS NOT NULL;

CREATE INDEX idx_audit_logs_action          ON audit_logs (action);

-- BRIN is ideal for append-only monotonically increasing timestamps
CREATE INDEX idx_audit_logs_created_brin    ON audit_logs USING BRIN (created_at);

-- =============================================================================
-- SECTION 2: CSV SERVICE DATABASE
-- =============================================================================
-- All tables carry org_id NOT NULL for tenant isolation.
-- Row-Level Security is enabled on every table.
-- Application middleware sets: SET app.current_org_id = '<uuid>';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions (if running in a separate database)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM Types — CSV Service
-- ---------------------------------------------------------------------------

CREATE TYPE project_status        AS ENUM ('active', 'archived');

CREATE TYPE upload_status         AS ENUM (
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
);

CREATE TYPE schema_status         AS ENUM ('draft', 'in_review', 'confirmed', 'rejected');
CREATE TYPE field_type            AS ENUM ('text', 'number', 'boolean', 'enum', 'url');
CREATE TYPE run_status            AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE item_status           AS ENUM ('ok', 'collision', 'manual_override');
CREATE TYPE collision_type        AS ENUM ('value_conflict', 'duplicate_sku', 'out_of_range', 'missing_required');
CREATE TYPE collision_status      AS ENUM ('open', 'resolved', 'ignored');
CREATE TYPE review_task_type      AS ENUM ('schema_review', 'collision_review', 'seo_review');
CREATE TYPE review_task_status    AS ENUM ('pending', 'in_progress', 'completed', 'skipped');
CREATE TYPE export_status         AS ENUM ('queued', 'generating', 'ready', 'expired', 'failed');

-- ---------------------------------------------------------------------------
-- TABLE: projects
-- Logical container for grouping UploadJobs by topic/category.
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
    id          UUID           NOT NULL DEFAULT gen_random_uuid(),
    org_id      UUID           NOT NULL,   -- tenant scope; no FK (cross-DB)
    created_by  UUID           NOT NULL,   -- user_id from CP JWT
    name        TEXT           NOT NULL,
    description TEXT           NULL,
    status      project_status NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ    NULL,

    CONSTRAINT projects_pkey        PRIMARY KEY (id),
    CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 255)
);

COMMENT ON TABLE  projects         IS 'Groups UploadJobs by product category or campaign.';
COMMENT ON COLUMN projects.org_id  IS 'Tenant identifier. No cross-DB FK — enforced by RLS + application.';

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_isolation ON projects
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE INDEX idx_projects_org_status  ON projects (org_id, status);
CREATE INDEX idx_projects_org_created ON projects (org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- TABLE: uploads
-- Central pipeline aggregate. One row = one uploaded CSV file and its entire
-- enrichment lifecycle. All child entities reference this table.
-- ---------------------------------------------------------------------------
CREATE TABLE uploads (
    id                UUID          NOT NULL DEFAULT gen_random_uuid(),
    org_id            UUID          NOT NULL,
    project_id        UUID          NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
    created_by        UUID          NOT NULL,
    original_filename TEXT          NOT NULL,
    s3_key_raw        TEXT          NOT NULL,   -- {org_id}/{id}/raw/{filename}
    s3_key_result     TEXT          NULL,       -- {org_id}/{id}/result/{filename}
    row_count         INTEGER       NULL,       -- populated after parsing
    file_size_bytes   BIGINT        NULL,
    status            upload_status NOT NULL DEFAULT 'pending',
    error_message     TEXT          NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ   NULL,

    CONSTRAINT uploads_pkey              PRIMARY KEY (id),
    CONSTRAINT uploads_row_count_gte_0   CHECK (row_count IS NULL OR row_count >= 0),
    CONSTRAINT uploads_file_size_gte_0   CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    CONSTRAINT uploads_s3_key_prefix     CHECK (s3_key_raw LIKE org_id::TEXT || '/%')
);

COMMENT ON TABLE  uploads                IS 'Central aggregate for the CSV enrichment pipeline.';
COMMENT ON COLUMN uploads.s3_key_raw     IS 'S3 path: {org_id}/{upload_id}/raw/. Tenant-scoped by convention and policy.';
COMMENT ON COLUMN uploads.s3_key_result  IS 'S3 path: {org_id}/{upload_id}/result/. Set after export.';

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY uploads_tenant_isolation ON uploads
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE INDEX idx_uploads_org_status    ON uploads (org_id, status);
CREATE INDEX idx_uploads_org_project   ON uploads (org_id, project_id);
CREATE INDEX idx_uploads_org_created   ON uploads (org_id, created_at DESC);
CREATE INDEX idx_uploads_project_id    ON uploads (project_id);

-- ---------------------------------------------------------------------------
-- TABLE: schema_templates
-- AI-generated attribute template for a job, versioned and confirmed by a human.
-- Only one 'confirmed' template may exist per upload_id.
-- ---------------------------------------------------------------------------
CREATE TABLE schema_templates (
    id           UUID          NOT NULL DEFAULT gen_random_uuid(),
    org_id       UUID          NOT NULL,
    upload_id    UUID          NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
    version      INTEGER       NOT NULL DEFAULT 1,
    status       schema_status NOT NULL DEFAULT 'draft',
    confirmed_by UUID          NULL,
    confirmed_at TIMESTAMPTZ   NULL,
    ai_model     TEXT          NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT schema_templates_pkey              PRIMARY KEY (id),
    CONSTRAINT schema_templates_version_positive  CHECK (version > 0),
    CONSTRAINT schema_templates_confirmed_coherent CHECK (
        (status = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL) OR
        (status <> 'confirmed')
    )
);

COMMENT ON TABLE  schema_templates             IS 'Versioned attribute schema generated by AI and confirmed by a human reviewer.';
COMMENT ON COLUMN schema_templates.version     IS 'Incremented on every edit. Immutable after confirmation.';
COMMENT ON COLUMN schema_templates.confirmed_by IS 'User ID (from CP). Required when status = confirmed.';

ALTER TABLE schema_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY schema_templates_tenant_isolation ON schema_templates
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

-- Only one confirmed template per upload
CREATE UNIQUE INDEX uq_schema_templates_upload_confirmed
    ON schema_templates (upload_id)
    WHERE status = 'confirmed';

CREATE UNIQUE INDEX uq_schema_templates_upload_version
    ON schema_templates (upload_id, version);

CREATE INDEX idx_schema_templates_org_upload ON schema_templates (org_id, upload_id, status);

-- ---------------------------------------------------------------------------
-- TABLE: schema_fields
-- Individual attribute definition within a SchemaTemplate.
-- Immutable after the parent template is confirmed.
-- ---------------------------------------------------------------------------
CREATE TABLE schema_fields (
    id             UUID       NOT NULL DEFAULT gen_random_uuid(),
    org_id         UUID       NOT NULL,
    schema_id      UUID       NOT NULL REFERENCES schema_templates (id) ON DELETE CASCADE,
    name           TEXT       NOT NULL,   -- machine key: snake_case
    label          TEXT       NOT NULL,   -- display label
    field_type     field_type NOT NULL,
    is_required    BOOLEAN    NOT NULL DEFAULT FALSE,
    allowed_values TEXT[]     NULL,       -- only for field_type = 'enum'
    description    TEXT       NULL,       -- AI hint
    sort_order     INTEGER    NOT NULL DEFAULT 0,

    CONSTRAINT schema_fields_pkey             PRIMARY KEY (id),
    CONSTRAINT schema_fields_name_snake_case  CHECK (name ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT schema_fields_enum_values      CHECK (
        (field_type = 'enum' AND allowed_values IS NOT NULL AND cardinality(allowed_values) > 0) OR
        (field_type <> 'enum')
    )
);

COMMENT ON TABLE  schema_fields                IS 'Attribute definitions in a template. Immutable once template is confirmed.';
COMMENT ON COLUMN schema_fields.name           IS 'snake_case machine key used in enriched_data JSONB.';
COMMENT ON COLUMN schema_fields.allowed_values IS 'Non-null and non-empty only when field_type = enum.';

ALTER TABLE schema_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY schema_fields_tenant_isolation ON schema_fields
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE UNIQUE INDEX uq_schema_fields_schema_name ON schema_fields (schema_id, name);
CREATE INDEX idx_schema_fields_org_schema         ON schema_fields (org_id, schema_id);

-- ---------------------------------------------------------------------------
-- TABLE: enrichment_runs
-- One async attempt to AI-enrich all SKUs in an upload.
-- A partial UNIQUE index ensures only one run per upload can be 'running'.
-- ---------------------------------------------------------------------------
CREATE TABLE enrichment_runs (
    id               UUID       NOT NULL DEFAULT gen_random_uuid(),
    org_id           UUID       NOT NULL,
    upload_id        UUID       NOT NULL REFERENCES uploads          (id) ON DELETE CASCADE,
    schema_id        UUID       NOT NULL REFERENCES schema_templates (id) ON DELETE RESTRICT,
    status           run_status NOT NULL DEFAULT 'queued',
    total_items      INTEGER    NULL,
    processed_items  INTEGER    NOT NULL DEFAULT 0,
    failed_items     INTEGER    NOT NULL DEFAULT 0,
    tokens_used      INTEGER    NOT NULL DEFAULT 0,
    started_at       TIMESTAMPTZ NULL,
    completed_at     TIMESTAMPTZ NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT enrichment_runs_pkey                  PRIMARY KEY (id),
    CONSTRAINT enrichment_runs_processed_gte_0       CHECK (processed_items >= 0),
    CONSTRAINT enrichment_runs_failed_gte_0          CHECK (failed_items >= 0),
    CONSTRAINT enrichment_runs_tokens_gte_0          CHECK (tokens_used >= 0),
    CONSTRAINT enrichment_runs_started_coherent      CHECK (
        (status IN ('running','completed','failed') AND started_at IS NOT NULL) OR
        (status IN ('queued'))
    )
);

COMMENT ON TABLE enrichment_runs IS 'Async AI enrichment attempt. Only one run per upload may be in "running" state (partial unique index).';

ALTER TABLE enrichment_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY enrichment_runs_tenant_isolation ON enrichment_runs
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

-- Guarantee: at most one running run per upload (DB-enforced)
CREATE UNIQUE INDEX uq_enrichment_runs_upload_running
    ON enrichment_runs (upload_id)
    WHERE status = 'running';

CREATE INDEX idx_enrichment_runs_org_upload ON enrichment_runs (org_id, upload_id, status);

-- ---------------------------------------------------------------------------
-- TABLE: enriched_items
-- AI enrichment result for one SKU row. Stores raw and enriched JSONB payloads.
-- upload_id is denormalised for efficient filtering without joining runs.
-- ---------------------------------------------------------------------------
CREATE TABLE enriched_items (
    id              UUID        NOT NULL DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL,
    run_id          UUID        NOT NULL REFERENCES enrichment_runs (id) ON DELETE CASCADE,
    upload_id       UUID        NOT NULL REFERENCES uploads         (id) ON DELETE CASCADE,
    sku_external_id TEXT        NOT NULL,   -- original CSV row identifier
    raw_data        JSONB       NOT NULL DEFAULT '{}',
    enriched_data   JSONB       NOT NULL DEFAULT '{}',
    confidence      NUMERIC(4,3) NULL,      -- 0.000–1.000
    status          item_status NOT NULL DEFAULT 'ok',
    reviewed_by     UUID        NULL,
    reviewed_at     TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT enriched_items_pkey             PRIMARY KEY (id),
    CONSTRAINT enriched_items_confidence_range CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
    CONSTRAINT enriched_items_review_coherent  CHECK (
        (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR
        (reviewed_by IS NULL     AND reviewed_at IS NULL)
    )
);

COMMENT ON TABLE  enriched_items                IS 'Per-SKU AI enrichment output. enriched_data uses schema field names as keys.';
COMMENT ON COLUMN enriched_items.upload_id      IS 'Denormalised from run for efficient tenant-scoped queries.';
COMMENT ON COLUMN enriched_items.sku_external_id IS 'The identifier column value from the original CSV.';
COMMENT ON COLUMN enriched_items.confidence     IS 'Mean AI confidence across all fields. 0.000–1.000.';

ALTER TABLE enriched_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY enriched_items_tenant_isolation ON enriched_items
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE INDEX idx_enriched_items_org_run           ON enriched_items (org_id, run_id);
CREATE INDEX idx_enriched_items_org_upload_status ON enriched_items (org_id, upload_id, status);
CREATE INDEX idx_enriched_items_sku               ON enriched_items (upload_id, sku_external_id);

-- GIN index for JSONB field-level search (optional, enable if queried heavily)
-- CREATE INDEX idx_enriched_items_enriched_gin ON enriched_items USING GIN (enriched_data);

-- ---------------------------------------------------------------------------
-- TABLE: collisions
-- A value conflict detected during enrichment that requires human resolution.
-- An open collision can optionally block export (configurable per org).
-- ---------------------------------------------------------------------------
CREATE TABLE collisions (
    id              UUID             NOT NULL DEFAULT gen_random_uuid(),
    org_id          UUID             NOT NULL,
    run_id          UUID             NOT NULL REFERENCES enrichment_runs (id) ON DELETE CASCADE,
    item_id         UUID             NOT NULL REFERENCES enriched_items  (id) ON DELETE CASCADE,
    field_name      TEXT             NOT NULL,
    collision_type  collision_type   NOT NULL,
    value_a         TEXT             NULL,
    value_b         TEXT             NULL,
    resolved_value  TEXT             NULL,
    status          collision_status NOT NULL DEFAULT 'open',
    resolved_by     UUID             NULL,
    resolved_at     TIMESTAMPTZ      NULL,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),

    CONSTRAINT collisions_pkey               PRIMARY KEY (id),
    CONSTRAINT collisions_resolved_coherent  CHECK (
        (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_value IS NOT NULL AND resolved_at IS NOT NULL) OR
        (status <> 'resolved')
    )
);

COMMENT ON TABLE  collisions            IS 'Value conflicts detected during enrichment. Must be resolved or ignored before export (configurable).';
COMMENT ON COLUMN collisions.field_name IS 'The schema field name that has a conflicting value.';
COMMENT ON COLUMN collisions.value_a    IS 'First competing value (e.g., from AI run #1 or existing data).';
COMMENT ON COLUMN collisions.value_b    IS 'Second competing value (e.g., from AI run #2 or manual entry).';

ALTER TABLE collisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY collisions_tenant_isolation ON collisions
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE INDEX idx_collisions_org_run_status  ON collisions (org_id, run_id, status);
CREATE INDEX idx_collisions_item_status     ON collisions (item_id, status);

-- Partial index to quickly count open collisions blocking export
CREATE INDEX idx_collisions_org_open        ON collisions (org_id)
    WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- TABLE: review_tasks
-- Human-in-the-loop gate. The pipeline does not advance until the
-- required review task is completed (or explicitly skipped).
-- ---------------------------------------------------------------------------
CREATE TABLE review_tasks (
    id           UUID               NOT NULL DEFAULT gen_random_uuid(),
    org_id       UUID               NOT NULL,
    upload_id    UUID               NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
    task_type    review_task_type   NOT NULL,
    status       review_task_status NOT NULL DEFAULT 'pending',
    assigned_to  UUID               NULL,
    completed_by UUID               NULL,
    due_at       TIMESTAMPTZ        NULL,
    completed_at TIMESTAMPTZ        NULL,
    created_at   TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ        NOT NULL DEFAULT now(),

    CONSTRAINT review_tasks_pkey             PRIMARY KEY (id),
    CONSTRAINT review_tasks_completed_coherent CHECK (
        (status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL) OR
        (status <> 'completed')
    )
);

COMMENT ON TABLE  review_tasks           IS 'Human-in-the-loop gate tasks. Pipeline blocked until completed or skipped.';
COMMENT ON COLUMN review_tasks.task_type IS 'One of: schema_review, collision_review, seo_review.';

ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_tasks_tenant_isolation ON review_tasks
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

-- Guarantee: only one active task of each type per upload (DB-enforced)
CREATE UNIQUE INDEX uq_review_tasks_upload_type_active
    ON review_tasks (upload_id, task_type)
    WHERE status IN ('pending', 'in_progress');

CREATE INDEX idx_review_tasks_org_status    ON review_tasks (org_id, status);
CREATE INDEX idx_review_tasks_assigned_to   ON review_tasks (assigned_to, status)
    WHERE assigned_to IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TABLE: export_jobs
-- Async task to build and upload the final enriched CSV to S3.
-- signed_url expires after 1 hour; a background job sets status = 'expired'.
-- ---------------------------------------------------------------------------
CREATE TABLE export_jobs (
    id            UUID          NOT NULL DEFAULT gen_random_uuid(),
    org_id        UUID          NOT NULL,
    upload_id     UUID          NOT NULL REFERENCES uploads (id) ON DELETE RESTRICT,
    requested_by  UUID          NOT NULL,
    status        export_status NOT NULL DEFAULT 'queued',
    s3_key        TEXT          NULL,
    signed_url    TEXT          NULL,
    url_expires_at TIMESTAMPTZ  NULL,
    include_seo   BOOLEAN       NOT NULL DEFAULT FALSE,
    error_message TEXT          NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ   NULL,

    CONSTRAINT export_jobs_pkey               PRIMARY KEY (id),
    CONSTRAINT export_jobs_url_coherent        CHECK (
        (status = 'ready' AND s3_key IS NOT NULL AND signed_url IS NOT NULL AND url_expires_at IS NOT NULL) OR
        (status <> 'ready')
    )
);

COMMENT ON TABLE  export_jobs               IS 'Async CSV export tasks. signed_url TTL = 1 hour. Cleanup job sets status to expired.';
COMMENT ON COLUMN export_jobs.signed_url    IS 'S3 pre-signed URL. Expires after 1 hour. Do not cache on client indefinitely.';
COMMENT ON COLUMN export_jobs.include_seo   IS 'When TRUE, SEO description columns are appended to the export CSV.';

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY export_jobs_tenant_isolation ON export_jobs
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE INDEX idx_export_jobs_org_upload_status ON export_jobs (org_id, upload_id, status);

-- For the URL-expiry cleanup background job
CREATE INDEX idx_export_jobs_url_expires ON export_jobs (url_expires_at)
    WHERE status = 'ready';

-- ---------------------------------------------------------------------------
-- TABLE: seo_tasks
-- Async AI task to generate SEO titles and descriptions for all SKUs.
-- Can only start after enrichment_run.status = 'completed'.
-- ---------------------------------------------------------------------------
CREATE TABLE seo_tasks (
    id               UUID       NOT NULL DEFAULT gen_random_uuid(),
    org_id           UUID       NOT NULL,
    upload_id        UUID       NOT NULL REFERENCES uploads          (id) ON DELETE CASCADE,
    run_id           UUID       NOT NULL REFERENCES enrichment_runs  (id) ON DELETE RESTRICT,
    status           run_status NOT NULL DEFAULT 'queued',
    lang             TEXT       NOT NULL DEFAULT 'ru',
    total_items      INTEGER    NULL,
    processed_items  INTEGER    NOT NULL DEFAULT 0,
    tokens_used      INTEGER    NOT NULL DEFAULT 0,
    started_at       TIMESTAMPTZ NULL,
    completed_at     TIMESTAMPTZ NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT seo_tasks_pkey                  PRIMARY KEY (id),
    CONSTRAINT seo_tasks_lang_format           CHECK (lang ~ '^[a-z]{2}$'),
    CONSTRAINT seo_tasks_processed_gte_0       CHECK (processed_items >= 0),
    CONSTRAINT seo_tasks_tokens_gte_0          CHECK (tokens_used >= 0)
);

COMMENT ON TABLE  seo_tasks       IS 'Async SEO text generation per upload language. Starts only after enrichment_run.completed.';
COMMENT ON COLUMN seo_tasks.lang  IS 'ISO 639-1 two-letter language code (e.g. ru, en, uk).';

ALTER TABLE seo_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY seo_tasks_tenant_isolation ON seo_tasks
    USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

-- Only one running seo task per (upload, lang)
CREATE UNIQUE INDEX uq_seo_tasks_upload_lang_running
    ON seo_tasks (upload_id, lang)
    WHERE status = 'running';

CREATE INDEX idx_seo_tasks_org_upload ON seo_tasks (org_id, upload_id, status);

-- =============================================================================
-- SECTION 3: SEED — System Roles & Permissions
-- =============================================================================

INSERT INTO roles (id, org_id, name, description, is_system) VALUES
    (gen_random_uuid(), NULL, 'super_admin',     'Full platform access',                     TRUE),
    (gen_random_uuid(), NULL, 'org_owner',       'Full org access including billing/secrets', TRUE),
    (gen_random_uuid(), NULL, 'org_admin',       'Manage users and roles, no billing/secrets',TRUE),
    (gen_random_uuid(), NULL, 'service_manager', 'Manage service jobs, approve schemas',      TRUE),
    (gen_random_uuid(), NULL, 'analyst',         'Read results and export',                   TRUE),
    (gen_random_uuid(), NULL, 'viewer',          'Read-only access',                          TRUE);

INSERT INTO permissions (resource, action, description) VALUES
    -- Organizations
    ('organization', 'read',   'View org details'),
    ('organization', 'update', 'Edit org settings'),
    ('organization', 'delete', 'Delete org (super_admin only)'),
    -- Users
    ('user',         'create', 'Invite users'),
    ('user',         'read',   'List and view users'),
    ('user',         'update', 'Edit user profile / role'),
    ('user',         'delete', 'Remove user from org'),
    -- Projects
    ('project',      'create', 'Create new project'),
    ('project',      'read',   'View projects'),
    ('project',      'update', 'Edit project'),
    ('project',      'delete', 'Archive project'),
    -- Jobs
    ('job',          'create', 'Upload CSV and start job'),
    ('job',          'read',   'View job status and items'),
    ('job',          'update', 'Edit job settings'),
    -- Schema
    ('schema',       'read',   'View schema template'),
    ('schema',       'update', 'Edit schema draft'),
    ('schema',       'approve','Confirm schema template'),
    -- Collisions
    ('collision',    'read',   'View collisions'),
    ('collision',    'resolve','Resolve or ignore collisions'),
    -- Export
    ('export',       'create', 'Trigger export'),
    ('export',       'read',   'Download exported file'),
    -- SEO
    ('seo',          'create', 'Start SEO generation'),
    ('seo',          'read',   'View SEO results'),
    -- Secrets
    ('secret',       'create', 'Add provider config'),
    ('secret',       'update', 'Rotate provider config'),
    -- Audit
    ('audit',        'read',   'View audit logs');

-- =============================================================================
-- SECTION 4: HOUSEKEEPING
-- =============================================================================

-- Trigger helper: auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'organizations', 'users', 'memberships', 'roles',
        'service_registry', 'service_access', 'provider_configs',
        'projects', 'uploads', 'schema_templates', 'schema_fields',
        'enriched_items', 'review_tasks', 'export_jobs'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_set_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END;
$$;

COMMIT;
