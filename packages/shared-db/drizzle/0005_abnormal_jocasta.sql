DO $$ BEGIN
 CREATE TYPE "collision_status" AS ENUM('detected', 'pending_review', 'resolved', 'dismissed', 'ignored');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "enriched_item_status" AS ENUM('ok', 'collision', 'manual_override');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "enrichment_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'paused');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "export_status" AS ENUM('queued', 'generating', 'ready', 'expired', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "knowledge_source" AS ENUM('correction', 'confirmed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "seo_task_status" AS ENUM('queued', 'running', 'completed', 'failed', 'paused');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "upload_job_status" ADD VALUE 'paused';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"enriched_item_id" uuid NOT NULL,
	"field" text NOT NULL,
	"original_value" text,
	"suggested_values" text,
	"resolved_value" text,
	"reason" text NOT NULL,
	"status" "collision_status" DEFAULT 'detected' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enriched_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"sku_external_id" text NOT NULL,
	"raw_data" text,
	"enriched_data" text,
	"confidence" integer,
	"status" "enriched_item_status" DEFAULT 'ok' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"product_category" text,
	"input_context" text NOT NULL,
	"ai_value" text,
	"correct_value" text NOT NULL,
	"source" "knowledge_source" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"status" "enrichment_run_status" DEFAULT 'queued' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"last_processed_row_index" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"s3_key" text,
	"signed_url" text,
	"url_expires_at" timestamp,
	"include_seo" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"native_name" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "languages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"display_name" text,
	"input_cost_per_1m" numeric(10, 4) NOT NULL,
	"output_cost_per_1m" numeric(10, 4) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_pricing_model_unique" UNIQUE("model")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seo_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"status" "seo_task_status" DEFAULT 'queued' NOT NULL,
	"lang" text DEFAULT 'ru' NOT NULL,
	"total_items" integer DEFAULT 0,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"total_tokens" integer DEFAULT 100000 NOT NULL,
	"remaining_tokens" integer DEFAULT 100000 NOT NULL,
	"reset_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"service_id" uuid,
	"job_id" uuid,
	"tokens_used" integer NOT NULL,
	"model" text,
	"purpose" text NOT NULL,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "schema_fields" ADD COLUMN "is_filterable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schema_fields" ADD COLUMN "extraction_hint" text;--> statement-breakpoint
ALTER TABLE "schema_fields" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "schema_fields" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "schema_fields" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "schema_templates" ADD COLUMN "catalog_analysis" text;--> statement-breakpoint
ALTER TABLE "schema_templates" ADD COLUMN "golden_samples" text;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "include_seo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "catalog_context" text;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD COLUMN "lang" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_budget_idx" ON "token_budgets" ("org_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collisions" ADD CONSTRAINT "collisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collisions" ADD CONSTRAINT "collisions_job_id_upload_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "upload_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collisions" ADD CONSTRAINT "collisions_enriched_item_id_enriched_items_id_fk" FOREIGN KEY ("enriched_item_id") REFERENCES "enriched_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collisions" ADD CONSTRAINT "collisions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enriched_items" ADD CONSTRAINT "enriched_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enriched_items" ADD CONSTRAINT "enriched_items_run_id_enrichment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "enrichment_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enriched_items" ADD CONSTRAINT "enriched_items_upload_id_upload_jobs_id_fk" FOREIGN KEY ("upload_id") REFERENCES "upload_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enriched_items" ADD CONSTRAINT "enriched_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_knowledge" ADD CONSTRAINT "enrichment_knowledge_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_job_id_upload_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "upload_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_schema_id_schema_templates_id_fk" FOREIGN KEY ("schema_id") REFERENCES "schema_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_upload_id_upload_jobs_id_fk" FOREIGN KEY ("upload_id") REFERENCES "upload_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seo_tasks" ADD CONSTRAINT "seo_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seo_tasks" ADD CONSTRAINT "seo_tasks_upload_id_upload_jobs_id_fk" FOREIGN KEY ("upload_id") REFERENCES "upload_jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "seo_tasks" ADD CONSTRAINT "seo_tasks_run_id_enrichment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "enrichment_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_budgets" ADD CONSTRAINT "token_budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_usage_logs" ADD CONSTRAINT "token_usage_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_usage_logs" ADD CONSTRAINT "token_usage_logs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
