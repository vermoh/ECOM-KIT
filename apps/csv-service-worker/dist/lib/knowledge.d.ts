export interface KnowledgeEntry {
    fieldName: string;
    inputContext: string;
    aiValue: string | null;
    correctValue: string;
    source: 'correction' | 'confirmed';
}
/**
 * Load cross-org enrichment knowledge for given field names.
 * Returns corrections and confirmed examples across ALL organizations.
 * Prioritizes corrections (human-verified) over confirmed (AI high-confidence).
 */
export declare function loadKnowledge(fieldNames: string[], limit?: number): Promise<KnowledgeEntry[]>;
/**
 * Save a high-confidence enrichment result to the cross-org knowledge base.
 * Called selectively (not every row) to keep the knowledge base manageable.
 */
export declare function saveConfirmedKnowledge(orgId: string, fieldName: string, inputContext: string, value: string, productCategory?: string): Promise<void>;
/**
 * Format knowledge entries as a prompt block for enrichItem.
 */
export declare function formatKnowledgeForPrompt(entries: KnowledgeEntry[]): string;
//# sourceMappingURL=knowledge.d.ts.map