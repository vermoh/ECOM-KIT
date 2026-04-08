import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// ADR-004: all long-running operations go through queue with retry/backoff
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 100 }, // keep last 100 completed for observability
  removeOnFail: { count: 200 },     // keep last 200 failed for debugging
};

export const CSV_PARSING_QUEUE = 'csv-parsing';
export const ENRICHMENT_QUEUE = 'enrichment';
export const ENRICHMENT_PREVIEW_QUEUE = 'enrichment-preview';
export const EXPORT_QUEUE = 'export';

export const csvParsingQueue = new Queue(CSV_PARSING_QUEUE, {
  connection: redisConnection as any,
  defaultJobOptions,
});

export const enrichmentQueue = new Queue(ENRICHMENT_QUEUE, {
  connection: redisConnection as any,
  defaultJobOptions: {
    ...defaultJobOptions,
    backoff: { type: 'exponential' as const, delay: 10000 }, // longer for AI jobs
  },
});

export const enrichmentPreviewQueue = new Queue(ENRICHMENT_PREVIEW_QUEUE, {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  },
});

export const exportQueue = new Queue(EXPORT_QUEUE, {
  connection: redisConnection as any,
  defaultJobOptions,
});

export interface CSVJobData {
  uploadJobId: string;
  orgId: string;
  s3Key: string;
}

export interface EnrichmentJobData {
  enrichmentRunId: string;
  uploadJobId: string;
  orgId: string;
  s3Key: string;
}

export interface ExportJobData {
  exportJobId: string;
  uploadId: string;
  orgId: string;
  includeSeo: boolean;
}
