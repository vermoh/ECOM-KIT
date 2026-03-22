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
exports.CSV_PARSING_QUEUE = 'csv-parsing';
exports.ENRICHMENT_QUEUE = 'enrichment';
exports.EXPORT_QUEUE = 'export';
exports.csvParsingQueue = new bullmq_1.Queue(exports.CSV_PARSING_QUEUE, {
    connection: redisConnection,
});
exports.enrichmentQueue = new bullmq_1.Queue(exports.ENRICHMENT_QUEUE, {
    connection: redisConnection,
});
exports.exportQueue = new bullmq_1.Queue(exports.EXPORT_QUEUE, {
    connection: redisConnection,
});
//# sourceMappingURL=queue.js.map