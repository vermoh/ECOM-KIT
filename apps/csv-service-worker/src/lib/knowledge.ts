import { db, enrichmentKnowledge, eq, and, desc, inArray } from '@ecom-kit/shared-db';

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
export async function loadKnowledge(
  fieldNames: string[],
  limit: number = 20
): Promise<KnowledgeEntry[]> {
  if (fieldNames.length === 0) return [];

  try {
    // Load most recent knowledge entries for the requested fields
    // Cross-org: no orgId filter — this is the global knowledge base
    const entries = await db.query.enrichmentKnowledge.findMany({
      where: inArray(enrichmentKnowledge.fieldName, fieldNames),
      orderBy: [desc(enrichmentKnowledge.createdAt)],
      limit: limit * 2, // fetch extra, then filter/dedupe
    });

    // Dedupe by (fieldName + full inputContext)
    const seen = new Set<string>();
    const result: KnowledgeEntry[] = [];

    // Corrections first (higher value)
    const corrections = entries.filter(e => e.source === 'correction');
    const confirmed = entries.filter(e => e.source === 'confirmed');

    for (const entry of [...corrections, ...confirmed]) {
      const key = `${entry.fieldName}::${entry.inputContext ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        fieldName: entry.fieldName,
        inputContext: entry.inputContext,
        aiValue: entry.aiValue,
        correctValue: entry.correctValue,
        source: entry.source as 'correction' | 'confirmed',
      });
      if (result.length >= limit) break;
    }

    return result;
  } catch (err) {
    console.warn(`[Knowledge] Failed to load knowledge base for ${fieldNames.length} field(s) [${fieldNames.join(', ')}], proceeding without:`, err);
    return [];
  }
}

/**
 * Save a high-confidence enrichment result to the cross-org knowledge base.
 * Called selectively (not every row) to keep the knowledge base manageable.
 */
export async function saveConfirmedKnowledge(
  orgId: string,
  fieldName: string,
  inputContext: string,
  value: string,
  productCategory?: string
): Promise<void> {
  try {
    await db.insert(enrichmentKnowledge).values({
      orgId,
      fieldName,
      productCategory: productCategory || null,
      inputContext: String(inputContext).slice(0, 500),
      aiValue: null,
      correctValue: value,
      source: 'confirmed',
    });
  } catch (err) {
    // Non-fatal
    console.warn(`[Knowledge] Failed to save confirmed knowledge for field="${fieldName}" org="${orgId}":`, err);
  }
}

/**
 * Format knowledge entries as a prompt block for enrichItem.
 */
export function formatKnowledgeForPrompt(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return '';

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
