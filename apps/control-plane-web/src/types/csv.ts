export type UploadJobStatus =
  | 'PENDING'
  | 'PARSING'
  | 'PARSED'
  | 'SCHEMA_DRAFT'
  | 'SCHEMA_REVIEW'
  | 'SCHEMA_CONFIRMED'
  | 'ENRICHING'
  | 'ENRICHED'
  | 'NEEDS_COLLISION_REVIEW'
  | 'READY'
  | 'EXPORTING'
  | 'DONE'
  | 'FAILED';

export interface UploadJob {
  id: string;
  orgId: string;
  projectId: string;
  originalFilename: string;
  s3KeyRaw: string;
  s3KeyResult: string | null;
  rowCount: number;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
}

export type SchemaFieldType = 'text' | 'enum' | 'boolean' | 'number';

export interface SchemaField {
  id: string;
  name: string;
  label?: string;
  type: SchemaFieldType;
  required: boolean;
  allowedValues: string[];
  description?: string;
  extractionHint?: string;
}

export interface SchemaTemplate {
  id: string;
  status: 'draft' | 'in_review' | 'confirmed' | 'rejected';
  version: number;
  fields: SchemaField[];
}

export interface EnrichmentRun {
  id: string;
  jobId: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  processedItems: number;
  totalItems: number;
  progress: number;
  startedAt: string;
  completedAt: string | null;
}

export interface Collision {
  id: string;
  jobId: string;
  sku: string;
  field: string;
  type: 'duplicate' | 'out_of_range' | 'low_confidence' | 'ambiguous';
  valueA: string;
  valueB: string | null;
  status: 'detected' | 'pending_review' | 'resolved' | 'dismissed';
  resolvedValue: string | null;
}
