export declare function generateSchemaSuggestion(headers: string[], sampleData: any[], apiKey: string): Promise<Partial<any>[]>;
export declare function enrichItem(row: any, schemaFields: any[], apiKey: string): Promise<{
    enrichedData: any;
    confidence: number;
    tokensUsed: number;
}>;
export declare function generateSeoAttributes(itemData: any, lang: string, apiKey: string): Promise<{
    seoData: any;
    tokensUsed: number;
}>;
//# sourceMappingURL=ai.d.ts.map