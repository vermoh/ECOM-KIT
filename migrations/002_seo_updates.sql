-- =============================================================================
-- ECOM KIT Platform — SEO Updates Migration
-- Version  : 002
-- Date     : 2026-03-22
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABLE: uploads
-- Add include_seo flag to track if SEO generation is required for the job.
-- ---------------------------------------------------------------------------
ALTER TABLE uploads 
ADD COLUMN include_seo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN uploads.include_seo IS 'When TRUE, the pipeline waits for SEOGenerationTask before moving to READY.';

COMMIT;
