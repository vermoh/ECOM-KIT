/**
 * Sanitize user-provided text before injecting into AI prompts.
 * - Strips lines that look like prompt injection attempts
 * - Truncates to maxLen characters
 * - Escapes backticks and template literal syntax (${ })
 */
export declare function sanitizePromptInput(text: string, maxLen?: number): string;
export interface CatalogAnalysis {
    categories: {
        name: string;
        attributes: string[];
        exampleProducts: string[];
    }[];
    totalTokensUsed: number;
}
/**
 * Stage A: Analyse a product catalog to identify distinct categories/niches
 * and their key commercial + technical attributes.
 * Uses gpt-4o for higher quality (single call per upload).
 */
export declare function analyseProductCatalog(sampleRows: any[], apiKey: string, catalogContext?: string): Promise<CatalogAnalysis>;
export declare function generateSchemaSuggestion(headers: string[], sampleData: any[], uniqueCategories: string[], apiKey: string, catalogContext?: string, catalogAnalysis?: CatalogAnalysis): Promise<{
    fields: Partial<any>[];
    tokensUsed: number;
}>;
/**
 * Generate 2-3 few-shot enrichment examples from actual catalog rows and confirmed schema.
 * Called once at the start of an enrichment run; result is reused for all rows.
 */
/**
 * Match a CSV row to one of the known categories from Stage A analysis.
 * Uses explicit category column first, then keyword overlap scoring.
 * Returns the matched category object or null.
 */
export declare function detectRowCategory(row: any, categories: CatalogAnalysis['categories']): CatalogAnalysis['categories'][0] | null;
/**
 * Build a category-specific hint from the Stage A analysis for a matched category.
 * Injected into the enrichItem prompt to guide field extraction.
 */
export declare function buildCategoryHint(category: CatalogAnalysis['categories'][0] | null): string;
export declare function generateFewShotExamples(sampleRows: any[], schemaFields: any[], apiKey: string, catalogContext?: string): Promise<string>;
export declare function enrichItem(row: any, schemaFields: any[], apiKey: string, catalogContext?: string, fewShotExamples?: string, categoryHint?: string, liveExamples?: any[], knowledgeBlock?: string): Promise<{
    enrichedData: any;
    confidence: number;
    tokensUsed: number;
    uncertainFields: Record<string, string[]>;
}>;
/**
 * Post-process AI enrichment output.
 * With structured outputs (json_schema), types are guaranteed by the API.
 * This function handles:
 * - Enum case normalization (AI may return correct value in wrong case)
 * - Enum violation detection (value not in allowed set)
 * - Light type coercion as safety net for non-structured fallbacks
 */
export declare function postProcessEnrichedData(enrichedData: any, schemaFields: any[]): {
    data: any;
    enumViolations: {
        field: string;
        value: any;
        allowedValues: string[];
    }[];
};
export interface VerificationCorrection {
    field: string;
    oldValue: any;
    newValue: any;
    reason: string;
}
export interface VerificationResult {
    corrections: VerificationCorrection[];
    revisedConfidence: number;
    tokensUsed: number;
}
/**
 * Verification pass: use gpt-4o to review and correct low-confidence enrichment results.
 * Called only for rows with confidence < 70, limited to 20% of total rows.
 */
export declare function verifyEnrichedItem(row: any, enrichedData: any, schemaFields: any[], apiKey: string, catalogContext?: string): Promise<VerificationResult>;
export interface ConsistencyCluster {
    canonical: string;
    variants: string[];
    itemIds: string[];
}
export interface FieldConsistencyResult {
    field: string;
    clusters: ConsistencyCluster[];
}
/**
 * Analyse enriched items for value consistency across text fields.
 * Groups similar values (case differences, whitespace, minor typos) into clusters.
 * No external dependencies — uses case-insensitive grouping + simple similarity.
 */
export declare function analyseFieldConsistency(items: {
    id: string;
    enrichedData: any;
}[], schemaFields: any[]): FieldConsistencyResult[];
export declare function generateSeoAttributes(itemData: any, lang: string, apiKey: string): Promise<{
    seoData: any;
    tokensUsed: number;
}>;
//# sourceMappingURL=ai.d.ts.map