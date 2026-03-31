"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportQueue = exports.enrichmentQueue = exports.csvParsingQueue = exports.EXPORT_QUEUE = exports.ENRICHMENT_QUEUE = exports.CSV_PARSING_QUEUE = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const redisConnection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});
// ADR-004: all long-running operations go through queue with retry/backoff
const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 }, // keep last 100 completed for observability
    removeOnFail: { count: 200 }, // keep last 200 failed for debugging
};
exports.CSV_PARSING_QUEUE = 'csv-parsing';
exports.ENRICHMENT_QUEUE = 'enrichment';
exports.EXPORT_QUEUE = 'export';
exports.csvParsingQueue = new bullmq_1.Queue(exports.CSV_PARSING_QUEUE, {
    connection: redisConnection,
    defaultJobOptions,
});
exports.enrichmentQueue = new bullmq_1.Queue(exports.ENRICHMENT_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
        ...defaultJobOptions,
        backoff: { type: 'exponential', delay: 10000 }, // longer for AI jobs
    },
});
exports.exportQueue = new bullmq_1.Queue(exports.EXPORT_QUEUE, {
    connection: redisConnection,
    defaultJobOptions,
});
//# sourceMappingURL=queue.js.map