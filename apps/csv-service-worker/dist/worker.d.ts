import { Worker, Job, Queue } from 'bullmq';
export declare const CSV_PARSING_QUEUE = "csv-parsing";
export declare const GENERATE_SCHEMA_QUEUE = "generate-schema";
export declare const ENRICHMENT_QUEUE = "enrichment";
export declare const EXPORT_QUEUE = "export";
export declare const SEO_GENERATION_QUEUE = "seo-generation";
export declare const generateSchemaQueue: Queue<any, any, string, any, any, string>;
export declare const seoGenerationQueue: Queue<any, any, string, any, any, string>;
interface CSVJobData {
    uploadJobId: string;
    orgId: string;
    s3Key: string;
}
interface EnrichmentJobData {
    enrichmentRunId: string;
    uploadJobId: string;
    orgId: string;
    s3Key: string;
}
interface SeoJobData {
    seoTaskId: string;
    uploadJobId: string;
    enrichmentRunId: string;
    orgId: string;
    lang: string;
}
interface ExportJobData {
    exportJobId: string;
    uploadId: string;
    orgId: string;
    includeSeo: boolean;
}
export declare function processParsingJob(job: Job<CSVJobData>): Promise<void>;
export declare const parsingWorker: Worker<CSVJobData, any, string>;
export declare function processSchemaJob(job: Job<CSVJobData>): Promise<void>;
export declare const schemaWorker: Worker<CSVJobData, any, string>;
export declare function processEnrichmentJob(job: Job<EnrichmentJobData>): Promise<void>;
export declare const enrichmentWorker: Worker<EnrichmentJobData, any, string>;
export declare function processSeoJob(job: Job<SeoJobData>): Promise<void>;
export declare const seoWorker: Worker<SeoJobData, any, string>;
export declare function processExportJob(job: Job<ExportJobData>): Promise<void>;
export declare const exportWorker: Worker<ExportJobData, any, string>;
export {};
//# sourceMappingURL=worker.d.ts.map