import { Queue } from 'bullmq';
export declare const CSV_PARSING_QUEUE = "csv-parsing";
export declare const ENRICHMENT_QUEUE = "enrichment";
export declare const EXPORT_QUEUE = "export";
export declare const csvParsingQueue: Queue<any, any, string, any, any, string>;
export declare const enrichmentQueue: Queue<any, any, string, any, any, string>;
export declare const exportQueue: Queue<any, any, string, any, any, string>;
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
//# sourceMappingURL=queue.d.ts.map