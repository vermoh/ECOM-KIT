ALTER TABLE "organizations" ADD COLUMN "confidence_threshold" integer DEFAULT 80;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "verification_threshold" integer DEFAULT 70;