"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadKnowledge = loadKnowledge;
exports.saveConfirmedKnowledge = saveConfirmedKnowledge;
exports.formatKnowledgeForPrompt = formatKnowledgeForPrompt;
const shared_db_1 = require("@ecom-kit/shared-db");
/**
 * Load cross-org enrichment knowledge for given field names.
 * Returns corrections and confirmed examples across ALL organizations.
 * Prioritizes corrections (human-verified) over confirmed (AI high-confidence).
 */
async function loadKnowledge(fieldNames, limit = 20) {
    if (fieldNames.length === 0)
        return [];
    try {
        // Load most recent knowledge entries for the requested fields
        // Cross-org: no orgId filter — this is the global knowledge base
        const entries = await shared_db_1.db.query.enrichmentKnowledge.findMany({
            where: (0, shared_db_1.inArray)(shared_db_1.enrichmentKnowledge.fieldName, fieldNames),
            orderBy: [(0, shared_db_1.desc)(shared_db_1.enrichmentKnowledge.createdAt)],
            limit: limit * 2, // fetch extra, then filter/dedupe
        });
        // Dedupe by (fieldName + full inputContext)
        const seen = new Set();
        const result = [];
        // Corrections first (higher value)
        const corrections = entries.filter(e => e.source === 'correction');
        const confirmed = entries.filter(e => e.source === 'confirmed');
        for (const entry of [...corrections, ...confirmed]) {
            const key = `${entry.fieldName}::${entry.inputContext ?? ''}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            result.push({
                fieldName: entry.fieldName,
                inputContext: entry.inputContext,
                aiValue: entry.aiValue,
                correctValue: entry.correctValue,
                source: entry.source,
            });
            if (result.length >= limit)
                break;
        }
        return result;
    }
    catch (err) {
        console.warn(`[Knowledge] Failed to load knowledge base for ${fieldNames.length} field(s) [${fieldNames.join(', ')}], proceeding without:`, err);
        return [];
    }
}
/**
 * Save a high-confidence enrichment result to the cross-org knowledge base.
 * Called selectively (not every row) to keep the knowledge base manageable.
 */
async function saveConfirmedKnowledge(orgId, fieldName, inputContext, value, productCategory) {
    try {
        await shared_db_1.db.insert(shared_db_1.enrichmentKnowledge).values({
            orgId,
            fieldName,
            productCategory: productCategory || null,
            inputContext: String(inputContext).slice(0, 500),
            aiValue: null,
            correctValue: value,
            source: 'confirmed',
        });
    }
    catch (err) {
        // Non-fatal
        console.warn(`[Knowledge] Failed to save confirmed knowledge for field="${fieldName}" org="${orgId}":`, err);
    }
}
/**
 * Format knowledge entries as a prompt block for enrichItem.
 */
function formatKnowledgeForPrompt(entries) {
    if (entries.length === 0)
        return '';
    const corrections = entries.filter(e => e.source === 'correction');
    const confirmed = entries.filter(e => e.source === 'confirmed');
    let block = '\nKNOWLEDGE BASE (learned from previous enrichment runs across the platform):';
    if (corrections.length > 0) {
        block += '\n\nCORRECTIONS (human-verified — prioritize these patterns):';
        for (const c of corrections.slice(0, 10)) {
            block += `\n  Product: "${c.inputContext}" → field "${c.fieldName}": AI said "${c.aiValue}" → correct: "${c.correctValue}"`;
        }
    }
    if (confirmed.length > 0) {
        block += '\n\nCONFIRMED VALUES (high-confidence, verified by acceptance):';
        for (const c of confirmed.slice(0, 10)) {
            block += `\n  Product: "${c.inputContext}" → field "${c.fieldName}": "${c.correctValue}"`;
        }
    }
    block += '\n';
    return block;
}
//# sourceMappingURL=knowledge.js.map