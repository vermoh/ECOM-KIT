DO $$ BEGIN
 CREATE TYPE "upload_job_status" AS ENUM('pending', 'parsing', 'parsed', 'schema_draft', 'schema_review', 'schema_confirmed', 'enriching', 'enriched', 'needs_collision_review', 'ready', 'exporting', 'done', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "upload_job_status" DEFAULT 'pending' NOT NULL,
	"s3_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"row_count" integer,
	"error_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
