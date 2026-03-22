import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const CSV_PARSING_QUEUE = 'csv-parsing';
export const ENRICHMENT_QUEUE = 'enrichment';

export const csvParsingQueue = new Queue(CSV_PARSING_QUEUE, {
  connection: redisConnection as any,
});

export const enrichmentQueue = new Queue(ENRICHMENT_QUEUE, {
  connection: redisConnection as any,
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
