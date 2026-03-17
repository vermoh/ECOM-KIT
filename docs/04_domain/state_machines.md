# State Machines

## UploadJob
PENDING -> PARSING -> PARSED -> SCHEMA_DRAFT
SCHEMA_DRAFT -> SCHEMA_REVIEW
SCHEMA_REVIEW -> SCHEMA_DRAFT (rejected)
SCHEMA_REVIEW -> SCHEMA_CONFIRMED (approved)
SCHEMA_CONFIRMED -> ENRICHING
ENRICHING -> ENRICHED
ENRICHED -> NEEDS_COLLISION_REVIEW (if collisions)
NEEDS_COLLISION_REVIEW -> READY (resolved)
ENRICHED -> READY (if no collisions)
READY -> EXPORTING
EXPORTING -> DONE
* -> FAILED (on unrecoverable error)

## SchemaTemplate
draft -> in_review
in_review -> confirmed
in_review -> rejected
rejected -> draft (new version)

## EnrichmentRun
queued -> running
running -> paused
paused -> running
running -> completed
running -> failed
failed -> queued (retry if policy allows)
running -> cancelled

## Collision
detected -> pending_review
pending_review -> resolved
pending_review -> dismissed

## ExportJob
queued -> running
running -> completed
running -> failed
failed -> queued (retry)

## AccessGrant
active -> expired
active -> revoked
expired -> active (manual restore if policy allows)
revoked -> active (manual restore if policy allows)