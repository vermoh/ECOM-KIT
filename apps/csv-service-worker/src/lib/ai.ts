import { SchemaField } from '@ecom-kit/shared-types';
import { z } from 'zod';

// ─── Zod schemas for AI response validation ───

const CatalogAnalysisResponseSchema = z.object({
  merchant_niche: z.string().optional(),
  categories: z.array(z.object({
    name: z.string(),
    attributes: z.array(z.string()),
    example_products: z.array(z.string()),
  })).default([]),
});

const LanguageDetectionResponseSchema = z.string().min(2).max(5);

const SeoResponseSchema = z.object({
  seo_data: z.object({
    seo_title: z.string().default(''),
    seo_description: z.string().default(''),
    seo_keywords: z.string().default(''),
  }),
});

/** Patterns that look like prompt injection attempts */
const INJECTION_PATTERNS = /^(IGNORE|SYSTEM:|You are|Forget|Disregard)/im;

/**
 * Sanitize user-provided text before injecting into AI prompts.
 * - Strips lines that look like prompt injection attempts
 * - Truncates to maxLen characters
 * - Escapes backticks and template literal syntax (${ })
 */
export function sanitizePromptInput(text: string, maxLen = 2000): string {
  if (!text) return '';
  // Remove lines that match injection patterns
  const cleaned = text
    .split('\n')
    .filter(line => !INJECTION_PATTERNS.test(line.trim()))
    .join('\n');
  // Escape backticks and template literal expressions
  const escaped = cleaned.replace(/`/g, "'").replace(/\$\{/g, '${');
  // Truncate
  return escaped.length > maxLen ? escaped.slice(0, maxLen) + '…[truncated]' : escaped;
}

/** Check whether an API key is a mock/test key */
function isMockApiKey(apiKey: string): boolean {
  return apiKey === 'sk-or-v1-mock-key' || apiKey.startsWith('mock-');
}

export interface CatalogAnalysis {
  merchantNiche?: string;
  categories: { name: string; attributes: string[]; exampleProducts: string[] }[];
  totalTokensUsed: number;
}

/**
 * Stage A: Analyse a product catalog to identify distinct categories/niches
 * and their key commercial + technical attributes.
 * Uses gpt-4o for higher quality (single call per upload).
 */
export async function detectLanguage(sampleTexts: string[], apiKey: string): Promise<string> {
  if (isMockApiKey(apiKey)) return 'en';
  if (sampleTexts.length === 0) return 'en';

  const textsBlock = sampleTexts.slice(0, 10).join('\n');
  const prompt = `What language are these product names written in? Return ONLY the ISO 639-1 two-letter language code (e.g. 'en', 'ru', 'ro', 'fr'). Product names:\n${textsBlock}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: 'You are a language detection expert. Respond with only the ISO 639-1 code, nothing else.' },
          { role: 'user', content: prompt }
        ],
      })
    });

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] detectLanguage: no choices returned, defaulting to en');
      return 'en';
    }

    const raw = (data.choices[0].message.content || '').trim().toLowerCase();
    const code = raw.slice(0, 2);
    const validated = LanguageDetectionResponseSchema.safeParse(code);
    if (!validated.success) {
      console.warn(`[AI] detectLanguage: invalid response "${raw}", defaulting to en`);
      return 'en';
    }
    console.log(`[AI] detectLanguage: detected "${code}" from ${sampleTexts.length} sample texts`);
    return code || 'en';
  } catch (err) {
    console.warn('[AI] detectLanguage failed, defaulting to en:', err);
    return 'en';
  }
}

export async function analyseProductCatalog(
  sampleRows: any[],
  apiKey: string,
  catalogContext?: string,
  allProductNames?: string[],
  lang?: string
): Promise<CatalogAnalysis> {
  if (isMockApiKey(apiKey) || sampleRows.length === 0) {
    return { categories: [], totalTokensUsed: 0 };
  }

  const rowsBlock = sampleRows.map((row, i) => {
    const lines = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `  ${k}: ${sanitizePromptInput(String(v))}`)
      .join('\n');
    return `--- Product ${i + 1} ---\n${lines}`;
  }).join('\n\n');

  const contextLine = catalogContext
    ? `\nMERCHANT-PROVIDED DOMAIN CONTEXT:\n${sanitizePromptInput(catalogContext, 4000)}\n`
    : '';

  // Include ALL product names so AI can see the full catalog scope
  const namesBlock = allProductNames && allProductNames.length > 0
    ? `\nALL PRODUCT NAMES IN CATALOG (${allProductNames.length} products — use this to understand the FULL scope and niche of the store):\n${allProductNames.map((n, i) => `${i + 1}. ${sanitizePromptInput(n, 200)}`).join('\n')}\n`
    : '';

  const langInstruction = lang
    ? `\nIMPORTANT: Generate your response (category names, attribute names) in the language: ${lang}.\n`
    : '';

  const prompt = `You are a senior product catalog analyst. Study the sample products below and identify ALL distinct product categories or niches present in this catalog.

IMPORTANT: Pay special attention to product names — they often encode critical information like dimensions, materials, compatibility with other products, and product variants. Also identify the merchant's business niche/domain (e.g. "outdoor cooking equipment store", "electronics retailer", "vape shop").
${contextLine}${namesBlock}${langInstruction}
DETAILED SAMPLE PRODUCTS:
${rowsBlock}

YOUR TASK:
1. Identify the merchant's overall business niche/domain
2. Identify every distinct product category/niche represented in the data above
3. For each category, list the key commercial and technical attributes that are SPECIFIC to that niche — focus on attributes that matter for this particular type of product (e.g. "max_temperature_celsius" for ovens, "tier_count" for multi-level racks, "compatible_models" for accessories, "capacity_liters" for cookware)
4. Name 1-2 example products from the data that belong to each category

Respond ONLY with valid JSON:
{
  "merchant_niche": "Brief description of the store's domain",
  "categories": [
    {
      "name": "Human-readable category name",
      "attributes": ["attr1", "attr2", "attr3"],
      "example_products": ["Product Name 1", "Product Name 2"]
    }
  ]
}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are a product catalog analysis expert. Respond with valid JSON only, no markdown.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] analyseProductCatalog: no choices returned:', JSON.stringify(data).slice(0, 300));
      return { categories: [], totalTokensUsed: 0 };
    }

    const content = data.choices[0].message.content;
    console.log('[AI] Catalog analysis raw:', content?.slice(0, 500));

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[AI] analyseProductCatalog: failed to parse JSON, skipping analysis');
      return { categories: [], totalTokensUsed: data.usage?.total_tokens || 0 };
    }

    const validated = CatalogAnalysisResponseSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[AI] analyseProductCatalog: Zod validation failed:', validated.error.message);
      // Fallback to manual parsing for backwards compatibility
    }
    const safeData = validated.success ? validated.data : parsed;

    const merchantNiche = safeData.merchant_niche ? String(safeData.merchant_niche) : undefined;
    const cats = Array.isArray(safeData.categories) ? safeData.categories : [];
    const categories = cats.map((c: any) => ({
      name: String(c.name || ''),
      attributes: Array.isArray(c.attributes) ? c.attributes.map(String) : [],
      exampleProducts: Array.isArray(c.example_products) ? c.example_products.map(String) : [],
    })).filter((c: any) => c.name);

    console.log(`[AI] analyseProductCatalog: niche="${merchantNiche}", found ${categories.length} categories`);
    return { merchantNiche, categories, totalTokensUsed: data.usage?.total_tokens || 0 };
  } catch (err) {
    console.warn('[AI] analyseProductCatalog failed, schema generation will proceed without analysis:', err);
    return { categories: [], totalTokensUsed: 0 };
  }
}

export async function generateSchemaSuggestion(
  headers: string[],
  sampleData: any[],
  uniqueCategories: string[],
  apiKey: string,
  catalogContext?: string,
  catalogAnalysis?: CatalogAnalysis,
  lang?: string
): Promise<{ fields: Partial<any>[]; tokensUsed: number }> {
  // Explicit dev/test mode — only use mock when key is intentionally fake
  if (isMockApiKey(apiKey)) {
    console.log('[AI] Mock API key detected, returning fallback schema for dev/test');
    return { fields: _mockSchemaFallback(headers), tokensUsed: 0 };
  }

  const existingColumns = headers.join(', ');

  // Render sample rows as readable key:value blocks so the model treats every
  // field — especially long description fields — as meaningful signal.
  const sampleBlock = sampleData.map((row, i) => {
    const lines = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `  ${k}: ${sanitizePromptInput(String(v))}`)
      .join('\n');
    return `--- Product ${i + 1} ---\n${lines}`;
  }).join('\n\n');

  const categoriesBlock = uniqueCategories.length > 0
    ? `\nPRODUCT CATEGORIES FOUND IN THIS CATALOG:\n${uniqueCategories.map(c => `- ${c}`).join('\n')}`
    : '';

  const contextBlock = catalogContext
    ? `\nCATALOG DOMAIN CONTEXT (provided by the merchant):\n${sanitizePromptInput(catalogContext, 4000)}\n`
    : '';

  // Stage A analysis results — when available, gives the model a pre-analysed
  // breakdown of categories and their key attributes, leading to better field proposals.
  let analysisBlock = '';
  if (catalogAnalysis && catalogAnalysis.categories.length > 0) {
    const nicheInfo = catalogAnalysis.merchantNiche
      ? `\nMERCHANT NICHE (identified by catalog analysis): ${catalogAnalysis.merchantNiche}\n`
      : '';
    const catLines = catalogAnalysis.categories.map(c =>
      `• ${c.name}\n  Key attributes: ${c.attributes.join(', ')}\n  Examples: ${c.exampleProducts.join(', ')}`
    ).join('\n');
    analysisBlock = `${nicheInfo}\nPRE-ANALYSED CATALOG STRUCTURE (from Stage A analysis — use this to ensure coverage of ALL niches):\n${catLines}\n`;
  }

  // If user didn't provide context but Stage A identified the niche, use it
  const effectiveContextBlock = contextBlock || (catalogAnalysis?.merchantNiche
    ? `\nCATALOG DOMAIN CONTEXT (auto-detected):\nThis is a ${catalogAnalysis.merchantNiche}.\n`
    : '');

  const langRequirement = lang
    ? `\nLANGUAGE REQUIREMENT: Generate ALL field labels, descriptions, and allowed_values in ${lang}. Field names (snake_case keys) should remain in English, but labels and descriptions must be in ${lang}.\n`
    : '';

  const prompt = `You are a senior E-commerce catalog specialist. Propose enrichment fields based on a thorough catalog analysis.
${langRequirement}${effectiveContextBlock}${analysisBlock}
EXISTING CSV COLUMNS (already present — do NOT suggest these):
${existingColumns}
${categoriesBlock}

SAMPLE PRODUCT DATA (${sampleData.length} diverse rows — read descriptions carefully, they contain the richest product context):
${sampleBlock}

YOUR TASK:
Based on the catalog analysis and sample data above, propose enrichment fields that cover ALL identified product categories.

CRITICAL REQUIREMENT — NICHE SPECIFICITY:
You MUST prioritize niche-specific fields over generic ones. At least 60% of proposed fields should be specific to the merchant's domain.
For example: for a tandoor/outdoor cooking store, suggest "max_temperature_celsius", "diameter_cm", "tier_count", "compatible_tandoor_models", "capacity_liters" — NOT generic fields like "color" or "brand" unless they are truly relevant.
Product names often encode dimensions, materials, and compatibility info — extract these as dedicated fields.

REQUIREMENTS:
1. Propose 12-25 fields total:
   - 3-5 UNIVERSAL fields applicable to all products (brand, product_type, material)
   - 8-20 CATEGORY-SPECIFIC fields for each niche identified in the analysis — include the field's "description" to note which categories it applies to
2. Every field must be reliably extractable or inferable from product names and descriptions using AI
3. Every field must add real e-commerce value: filtering, search, logistics, compliance, or recommendations
4. If two categories share a similar concept (e.g. "volume" for liquids and "capacity" for tanks), DEDUPLICATE into a single field with a clear description covering both uses

THINK IN THESE DIMENSIONS:
- Physical: material, dimensions (diameter, height, width), weight, capacity/volume
- Technical: category-specific specs drawn from the analysis above (temperature, tiers, compatibility)
- Commercial: product_type, target use, intended_food_type, certifications
- Catalog: product_line, compatible_models, size_variant, country_of_origin

Respond with a JSON object containing a "fields" array. Each field must include:
- "name" (snake_case key)
- "label" (human-readable display name)
- "field_type" (one of: text, number, boolean, enum, url)
- "description" (what this field captures and which categories it applies to)
- "allowed_values" (array of strings for enum fields, empty array [] otherwise)
- "is_filterable" (boolean — true if this field is useful for catalog filtering/faceted search)
- "unit" (string or null — measurement unit for dimensional fields, e.g. "kg", "cm", "ml", "°C". null for non-dimensional fields)
- "confidence" (integer 0-100 — how confident you are that this field is relevant and extractable for this catalog)
- "rationale" (brief explanation of why this field is valuable for this specific catalog)`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a product data enrichment expert specializing in niche e-commerce catalogs.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA_SUGGESTION_RESPONSE_SCHEMA }
    })
  });

  const data = await response.json() as any;

  if (!data.choices || data.choices.length === 0) {
    const errMsg = data.error?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`AI_API_ERROR: ${errMsg}`);
  }

  const content = data.choices[0].message.content;
  console.log('[AI] Schema raw response:', content?.slice(0, 600));

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`AI_PARSE_ERROR: Schema response is not valid JSON. Raw: ${content?.slice(0, 200)}`);
  }

  // With structured outputs, the response is guaranteed to have "fields" array
  const fields = parsed.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error(`AI_FORMAT_ERROR: Fields array missing or empty.`);
  }

  const existingLower = new Set(headers.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_')));
  const newFields = fields.filter((f: any) => {
    const n = (f.name || '').toLowerCase();
    return n && !existingLower.has(n);
  });

  if (newFields.length === 0) {
    throw new Error('AI_FORMAT_ERROR: All suggested fields duplicate existing CSV columns — adjust the prompt or check CSV headers');
  }

  console.log(`[AI] generateSchemaSuggestion: got ${newFields.length} enrichment fields across ${uniqueCategories.length} categories`);
  return { fields: newFields, tokensUsed: data.usage?.total_tokens || 0 };
}

/** Fallback: propose sensible generic enrichment fields when AI is unavailable */
function _mockSchemaFallback(headers: string[]): Partial<any>[] {
  const existingLower = new Set(headers.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_')));
  const candidates = [
    { name: 'brand', label: 'Brand', field_type: 'text', is_required: false, description: 'Product manufacturer or brand name' },
    { name: 'color', label: 'Color', field_type: 'text', is_required: false, description: 'Primary product color' },
    { name: 'material', label: 'Material', field_type: 'text', is_required: false, description: 'Primary material used' },
    { name: 'weight_kg', label: 'Weight (kg)', field_type: 'number', is_required: false, description: 'Product weight in kilograms' },
    { name: 'warranty_months', label: 'Warranty (months)', field_type: 'number', is_required: false, description: 'Warranty period in months' },
    { name: 'in_stock', label: 'In Stock', field_type: 'boolean', is_required: false, description: 'Whether the product is currently in stock' },
    { name: 'country_of_origin', label: 'Country of Origin', field_type: 'text', is_required: false, description: 'Manufacturing country' },
    { name: 'target_audience', label: 'Target Audience', field_type: 'enum', is_required: false, description: 'Who this product is for', allowed_values: ['Men', 'Women', 'Kids', 'Unisex', 'Business'] },
  ];
  return candidates.filter(c => !existingLower.has(c.name));
}

/**
 * Generate 2-3 few-shot enrichment examples from actual catalog rows and confirmed schema.
 * Called once at the start of an enrichment run; result is reused for all rows.
 */
/**
 * Match a CSV row to one of the known categories from Stage A analysis.
 * Uses explicit category column first, then keyword overlap scoring.
 * Returns the matched category object or null.
 */
export function detectRowCategory(
  row: any,
  categories: CatalogAnalysis['categories']
): CatalogAnalysis['categories'][0] | null {
  if (!categories.length) return null;

  // 1. Check explicit category column
  const catField = row['Категория'] || row['категория'] || row['category'] || row['Category'] || row['type'] || row['Type'] || '';
  const catValue = String(catField).toLowerCase().trim();

  if (catValue) {
    // Exact substring match against known category names
    const exact = categories.find(c => {
      const cLow = c.name.toLowerCase();
      return cLow === catValue || catValue.includes(cLow) || cLow.includes(catValue);
    });
    if (exact) return exact;
  }

  // 2. Keyword overlap: build a text blob from the row, score against each category
  const rowText = Object.values(row)
    .filter(v => v !== null && v !== undefined)
    .map(v => String(v).toLowerCase())
    .join(' ');

  let bestScore = 0;
  let bestCat: CatalogAnalysis['categories'][0] | null = null;

  for (const cat of categories) {
    // Score = how many category keywords (name words + attributes) appear in row text
    const keywords = [
      ...cat.name.toLowerCase().split(/\s+/),
      ...cat.attributes.map(a => a.toLowerCase()),
    ];
    const score = keywords.filter(kw => kw.length > 2 && rowText.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }

  // Require at least 2 keyword matches to avoid false positives
  return bestScore >= 2 ? bestCat : (categories[0] || null);
}

/**
 * Build a category-specific hint from the Stage A analysis for a matched category.
 * Injected into the enrichItem prompt to guide field extraction.
 */
export function buildCategoryHint(category: CatalogAnalysis['categories'][0] | null): string {
  if (!category) return '';
  return `\nPRODUCT CATEGORY DETECTED: ${category.name}\nKey attributes for this category: ${category.attributes.join(', ')}.\nPay special attention to these attributes when filling the fields below.\n`;
}

/** Static JSON Schema for generateSchemaSuggestion response */
const SCHEMA_SUGGESTION_RESPONSE_SCHEMA = {
  name: 'schema_suggestion',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'snake_case field key' },
            label: { type: 'string', description: 'Human-readable label' },
            field_type: { type: 'string', enum: ['text', 'number', 'boolean', 'enum', 'url'] },
            description: { type: 'string', description: 'What this field captures and which categories it applies to' },
            allowed_values: { type: 'array', items: { type: 'string' }, description: 'Only for enum fields; empty array otherwise' },
            is_filterable: { type: 'boolean', description: 'Whether this field is useful for catalog filtering/faceted search' },
            unit: { type: ['string', 'null'], description: 'Measurement unit for dimensional fields (e.g. "kg", "cm", "ml"), null otherwise' },
            confidence: { type: 'integer', description: 'AI confidence 0-100 that this field is relevant and extractable' },
            rationale: { type: 'string', description: 'Brief explanation of why this field is valuable for this catalog' },
          },
          required: ['name', 'label', 'field_type', 'description', 'allowed_values', 'is_filterable', 'unit', 'confidence', 'rationale'],
          additionalProperties: false,
        },
      },
    },
    required: ['fields'],
    additionalProperties: false,
  },
};

/**
 * Build a JSON Schema object for the enrichItem response based on dynamic schema fields.
 * Used with response_format: { type: "json_schema" } for guaranteed type correctness.
 */
function buildEnrichmentJsonSchema(schemaFields: any[]): any {
  const enrichedProps: any = {};
  const enrichedRequired: string[] = [];

  for (const f of schemaFields) {
    const type = f.fieldType || 'text';
    enrichedRequired.push(f.name);

    if (type === 'number') {
      enrichedProps[f.name] = { type: 'number' };
    } else if (type === 'boolean') {
      enrichedProps[f.name] = { type: 'boolean' };
    } else if (type === 'enum' && Array.isArray(f.allowedValues) && f.allowedValues.length > 0) {
      enrichedProps[f.name] = { type: 'string', enum: f.allowedValues };
    } else {
      enrichedProps[f.name] = { type: 'string' };
    }
  }

  // Build field_confidence schema: same keys as enriched_data, but all integer values
  const fieldConfidenceProps: any = {};
  const fieldConfidenceRequired: string[] = [];
  for (const f of schemaFields) {
    fieldConfidenceProps[f.name] = { type: 'integer' };
    fieldConfidenceRequired.push(f.name);
  }

  return {
    name: 'enriched_product',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string' },
        enriched_data: {
          type: 'object',
          properties: enrichedProps,
          required: enrichedRequired,
          additionalProperties: false,
        },
        confidence: { type: 'integer' },
        field_confidence: {
          type: 'object',
          description: 'Per-field confidence scores (0-100)',
          properties: fieldConfidenceProps,
          required: fieldConfidenceRequired,
          additionalProperties: false,
        },
        uncertain_fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              alternatives: { type: 'array', items: { type: 'string' } },
            },
            required: ['field', 'alternatives'],
            additionalProperties: false,
          },
        },
      },
      required: ['reasoning', 'enriched_data', 'confidence', 'field_confidence', 'uncertain_fields'],
      additionalProperties: false,
    },
  };
}

export async function generateFewShotExamples(
  sampleRows: any[],
  schemaFields: any[],
  apiKey: string,
  catalogContext?: string
): Promise<string> {
  if (isMockApiKey(apiKey) || sampleRows.length === 0 || schemaFields.length === 0) {
    return '';
  }

  const fieldList = schemaFields.map(f => {
    let s = `  "${f.name}" (${f.fieldType || 'text'})`;
    if (Array.isArray(f.allowedValues) && f.allowedValues.length) {
      s += ` — one of: ${f.allowedValues.join(', ')}`;
    }
    return s;
  }).join('\n');

  const rows = sampleRows.slice(0, 5).map((row, i) => {
    const lines = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `    ${k}: ${sanitizePromptInput(String(v))}`)
      .join('\n');
    return `  --- Product ${i + 1} ---\n${lines}`;
  }).join('\n\n');

  const contextLine = catalogContext ? `\nCatalog domain: ${sanitizePromptInput(catalogContext, 4000)}\n` : '';

  const prompt = `You are preparing few-shot examples for an AI enrichment prompt.${contextLine}

SCHEMA FIELDS TO FILL:
${fieldList}

SAMPLE PRODUCTS FROM THIS CATALOG:
${rows}

TASK: Create 2 complete enrichment examples using 2 of the products above. Each example shows:
- INPUT: the raw product data (key: value pairs, compact format)
- OUTPUT: all schema fields filled with correct values

Format exactly like this:
--- Example 1 ---
INPUT:
  <key>: <value>
  ...
OUTPUT:
  <field_name> → <value>
  ...

--- Example 2 ---
INPUT:
  <key>: <value>
  ...
OUTPUT:
  <field_name> → <value>
  ...

Rules:
- Use real data from the products above
- Fill ALL schema fields in each output
- Be precise: numbers as numbers, booleans as true/false, enums from allowed list only
- Do NOT add any explanation outside the example blocks`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are creating training examples for an AI prompt. Follow the format exactly.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] generateFewShotExamples: no choices returned, skipping few-shot');
      return '';
    }

    const content = (data.choices[0].message.content || '').trim();
    console.log(`[AI] generateFewShotExamples: generated ${content.split('--- Example').length - 1} examples`);
    return content;
  } catch (err) {
    console.warn('[AI] generateFewShotExamples failed, enrichment will proceed without few-shot:', err);
    return '';
  }
}

export async function enrichItem(
  row: any,
  schemaFields: any[],
  apiKey: string,
  catalogContext?: string,
  fewShotExamples?: string,
  categoryHint?: string,
  liveExamples?: any[],
  knowledgeBlock?: string,
  lang?: string
): Promise<{ enrichedData: any; confidence: number; fieldConfidence: Record<string, number>; tokensUsed: number; uncertainFields: Record<string, string[]> }> {
  const fieldNames = schemaFields.map(f => f.name);
  const schemaDescription = schemaFields.map(f => {
    let desc = `- "${f.name}" (${f.fieldType || 'text'}): ${f.description || f.label || f.name}`;
    if (Array.isArray(f.allowedValues) && f.allowedValues.length) {
      desc += `. MUST be one of: ${f.allowedValues.join(', ')}`;
    }
    if (f.extractionHint) {
      desc += `\n  HINT: ${sanitizePromptInput(f.extractionHint, 500)}`;
    }
    return desc;
  }).join('\n');

  // Build a human-readable breakdown of the row so the AI treats every field
  // as meaningful signal, regardless of how the CSV column was originally named.
  const rowContext = Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `  ${k}: ${sanitizePromptInput(String(v))}`)
    .join('\n');

  const contextBlock = catalogContext
    ? `\nCATALOG DOMAIN: ${sanitizePromptInput(catalogContext, 4000)}\n`
    : '';

  const fewShotBlock = fewShotExamples
    ? `\nFEW-SHOT EXAMPLES (use these as reference for inference style, value format, and field coverage):\n${fewShotExamples}\n`
    : '';

  const categoryBlock = categoryHint || '';

  // Live examples: high-confidence enrichment results from the same category in this run
  let liveExamplesBlock = '';
  if (liveExamples && liveExamples.length > 0) {
    const exLines = liveExamples.map((ex, i) => {
      const inputLines = Object.entries(ex.input)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .slice(0, 5)
        .map(([k, v]) => `    ${k}: ${sanitizePromptInput(String(v))}`)
        .join('\n');
      const outputLines = Object.entries(ex.output)
        .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
        .join('\n');
      return `  --- Similar Product ${i + 1} ---\n  INPUT:\n${inputLines}\n  OUTPUT:\n${outputLines}`;
    }).join('\n\n');
    liveExamplesBlock = `\nPREVIOUSLY ENRICHED SIMILAR PRODUCTS (from this batch — use for consistency in brand names, value formats, and style):\n${exLines}\n`;
  }

  const kbBlock = knowledgeBlock
    ? sanitizePromptInput(knowledgeBlock, 8000)
    : '';

  const langInstruction = lang
    ? `LANGUAGE: Generate ALL enrichment values in ${lang}. All text, enum values, and descriptions must be in ${lang}.`
    : 'For text fields: return a concise string. Match the language of the input data.';

  const prompt = `You are an E-commerce product data enrichment engine. Your job is to fill in product attributes by extracting or intelligently inferring values from the raw product data.
${contextBlock}${categoryBlock}
The product data may be in any language (including Russian). Read and understand EVERY field — product name, description, and category all contain important clues.
${kbBlock}${fewShotBlock}${liveExamplesBlock}
RAW PRODUCT DATA:
${rowContext}

FIELDS TO FILL (fill ALL of them):
${schemaDescription}

STEP 1 — ANALYSIS (write a brief chain-of-thought inside the "reasoning" field):
- Identify the product type and niche
- Identify the brand (if visible in name, description, or category)
- Note key characteristics visible in name and description (specs, flavors, dimensions, etc.)

STEP 2 — FILL all fields based on your analysis.

RULES:
1. Read ALL input fields above carefully — the description field often contains the richest context.
2. Extract the value directly when explicitly stated. Infer plausible values when not stated.
3. For boolean fields: return true or false (not "yes"/"no").
4. For number fields: return a number only (integer or float), no units in the value.
5. For enum fields: return exactly one of the allowed values listed.
6. ${langInstruction}
7. NEVER return null or omit a field. If genuinely unknown, return the most plausible default for this product type and niche.

STEP 3 — CONFIDENCE ASSESSMENT:
- In "field_confidence", provide a confidence score (0-100) for EACH field individually. Score based on: was the value explicitly stated (90-100), reasonably inferred (70-89), or guessed (below 70)?
- The overall "confidence" is the weighted average of all field confidences.
- For any field where you are LESS THAN 80% certain, add an entry to "uncertain_fields" array with 2-3 plausible alternatives. This helps the human reviewer pick the best option. If you are confident in all values, return an empty array [].`;

  const enrichmentSchema = buildEnrichmentJsonSchema(schemaFields);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are a data enrichment engine with deep knowledge of e-commerce product catalogs.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_schema', json_schema: enrichmentSchema }
      })
    });

    const data = await response.json() as any;
    
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] enrichItem: OpenRouter returned no choices:', JSON.stringify(data).slice(0, 300));
      
      // Fallback for E2E testing without real key
      if (isMockApiKey(apiKey)) {
        console.log('[AI] Using Mock Enrichment fallback');
        // Copy the original CSV row data directly — schema field names may not
        // match CSV column names, so looking up row[f.name] is always undefined.
        const mockEnriched: any = { ...row };
        schemaFields.forEach(f => {
          if (mockEnriched[f.name] === undefined) {
            mockEnriched[f.name] = f.fieldType === 'number' ? 100 : `[mock] ${f.label || f.name}`;
          }
        });
        const mockFieldConf: Record<string, number> = {};
        schemaFields.forEach(f => { mockFieldConf[f.name] = 95; });
        return {
          enrichedData: mockEnriched,
          confidence: 95,
          fieldConfidence: mockFieldConf,
          tokensUsed: 150,
          uncertainFields: {}
        };
      }
      throw new Error(`AI_API_ERROR: ${data.error?.message || 'Unknown error'}`);
    }

    const content = data.choices[0].message.content;
    console.log('[AI] enrichItem raw response:', content?.slice(0, 300));
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[AI] enrichItem: failed to parse JSON response, raw:', content?.slice(0, 200));
      throw new Error('AI_PARSE_ERROR: Response is not valid JSON');
    }

    // With structured outputs, keys are guaranteed — but keep fallbacks for safety
    const enrichedData = parsed.enriched_data ?? parsed.enrichedData ?? {};

    // Parse uncertain_fields: structured output returns array format
    const uncertainFields: Record<string, string[]> = {};
    const rawUncertain = parsed.uncertain_fields ?? parsed.uncertainFields;
    if (Array.isArray(rawUncertain)) {
      // Structured output format: [{ field: "name", alternatives: ["a", "b"] }]
      for (const entry of rawUncertain) {
        if (entry?.field && Array.isArray(entry.alternatives) && entry.alternatives.length > 0) {
          uncertainFields[entry.field] = entry.alternatives.map(String);
        }
      }
    } else if (rawUncertain && typeof rawUncertain === 'object') {
      // Legacy format fallback: { field_name: ["a", "b"] }
      for (const [k, v] of Object.entries(rawUncertain)) {
        if (Array.isArray(v) && v.length > 0) {
          uncertainFields[k] = v.map(String);
        }
      }
    }

    // Parse per-field confidence scores
    const fieldConfidence: Record<string, number> = {};
    const rawFieldConf = parsed.field_confidence ?? parsed.fieldConfidence;
    if (rawFieldConf && typeof rawFieldConf === 'object') {
      for (const [k, v] of Object.entries(rawFieldConf)) {
        if (typeof v === 'number') {
          fieldConfidence[k] = v;
        }
      }
    }

    return {
      enrichedData,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 70,
      fieldConfidence,
      tokensUsed: data.usage?.total_tokens || 0,
      uncertainFields
    };
  } catch (error) {
    console.error('Error in enrichItem:', error);
    throw error;
  }
}

/**
 * Post-process AI enrichment output.
 * With structured outputs (json_schema), types are guaranteed by the API.
 * This function handles:
 * - Enum case normalization (AI may return correct value in wrong case)
 * - Enum violation detection (value not in allowed set)
 * - Light type coercion as safety net for non-structured fallbacks
 */
export function postProcessEnrichedData(
  enrichedData: any,
  schemaFields: any[]
): { data: any; enumViolations: { field: string; value: any; allowedValues: string[] }[] } {
  const data: any = { ...enrichedData };
  const enumViolations: { field: string; value: any; allowedValues: string[] }[] = [];

  for (const field of schemaFields) {
    const raw = data[field.name];
    if (raw === null || raw === undefined) continue;

    const type = field.fieldType || 'text';

    // Safety net: coerce number/boolean if AI somehow returned wrong type
    if (type === 'number' && typeof raw !== 'number') {
      const num = Number(String(raw).replace(/[^\d.-]/g, ''));
      data[field.name] = isNaN(num) ? null : num;
    } else if (type === 'boolean' && typeof raw !== 'boolean') {
      const s = String(raw).toLowerCase().trim();
      data[field.name] = s === 'true' || s === '1' || s === 'yes' || s === 'да';
    } else if (type === 'enum') {
      // Enum case normalization + violation detection
      const allowed: string[] = Array.isArray(field.allowedValues) ? field.allowedValues : [];
      if (allowed.length > 0) {
        const actual = String(raw).trim();
        const canonical = allowed.find(v => v.toLowerCase() === actual.toLowerCase());
        if (canonical) {
          data[field.name] = canonical;
        } else {
          enumViolations.push({ field: field.name, value: actual, allowedValues: allowed });
        }
      }
    }
  }

  return { data, enumViolations };
}

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
export async function verifyEnrichedItem(
  row: any,
  enrichedData: any,
  schemaFields: any[],
  apiKey: string,
  catalogContext?: string
): Promise<VerificationResult> {
  const rowContext = Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const enrichedContext = Object.entries(enrichedData)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  const fieldDescriptions = schemaFields.map(f => {
    let desc = `- "${f.name}" (${f.fieldType || 'text'}): ${f.description || f.label || f.name}`;
    if (Array.isArray(f.allowedValues) && f.allowedValues.length) {
      desc += `. Allowed: ${f.allowedValues.join(', ')}`;
    }
    return desc;
  }).join('\n');

  const contextLine = catalogContext ? `\nCatalog domain: ${catalogContext}\n` : '';

  const prompt = `You are a senior product data quality reviewer. An AI enrichment engine has filled in product attributes, but the results have LOW CONFIDENCE. Your job is to review each value and correct any errors.
${contextLine}
ORIGINAL PRODUCT DATA:
${rowContext}

AI-GENERATED ENRICHED VALUES (review these):
${enrichedContext}

FIELD DEFINITIONS:
${fieldDescriptions}

TASK:
For each enriched field, evaluate:
1. Is the value plausible given the original product data?
2. Is there a better value that can be extracted or inferred?
3. Is the value the correct type (number as number, boolean as true/false)?

Return corrections for ANY field that is wrong or can be improved. If a field is correct, do NOT include it.
Also provide a revised overall confidence score (60-100) reflecting the quality after your corrections.`;

  const verificationSchema = {
    name: 'verification_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              old_value: { type: 'string' },
              new_value: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['field', 'old_value', 'new_value', 'reason'],
            additionalProperties: false,
          },
        },
        revised_confidence: { type: 'integer' },
      },
      required: ['corrections', 'revised_confidence'],
      additionalProperties: false,
    },
  };

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are a data quality reviewer. Review AI-generated product data and correct errors.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_schema', json_schema: verificationSchema }
      })
    });

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] verifyEnrichedItem: no choices returned');
      return { corrections: [], revisedConfidence: 0, tokensUsed: 0 };
    }

    const content = data.choices[0].message.content;
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[AI] verifyEnrichedItem: failed to parse response');
      return { corrections: [], revisedConfidence: 0, tokensUsed: data.usage?.total_tokens || 0 };
    }

    const corrections: VerificationCorrection[] = (parsed.corrections || []).map((c: any) => ({
      field: c.field,
      oldValue: c.old_value,
      newValue: c.new_value,
      reason: c.reason,
    }));

    return {
      corrections,
      revisedConfidence: typeof parsed.revised_confidence === 'number' ? parsed.revised_confidence : 70,
      tokensUsed: data.usage?.total_tokens || 0,
    };
  } catch (err) {
    console.error('[AI] verifyEnrichedItem failed:', err);
    return { corrections: [], revisedConfidence: 0, tokensUsed: 0 };
  }
}

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
export function analyseFieldConsistency(
  items: { id: string; enrichedData: any }[],
  schemaFields: any[]
): FieldConsistencyResult[] {
  const textFields = schemaFields.filter(f => (f.fieldType || 'text') === 'text');
  const results: FieldConsistencyResult[] = [];

  for (const field of textFields) {
    // Collect all values for this field: normalized key → { original variants, item IDs }
    const groups = new Map<string, { variants: Map<string, number>; itemIds: string[] }>();
    type GroupEntry = { variants: Map<string, number>; itemIds: string[] };

    for (const item of items) {
      const data = typeof item.enrichedData === 'string' ? JSON.parse(item.enrichedData) : item.enrichedData;
      const val = data?.[field.name];
      if (val === null || val === undefined || String(val).trim() === '') continue;

      const original = String(val).trim();
      // Normalize: lowercase, collapse whitespace, strip trailing punctuation
      const key = original.toLowerCase().replace(/\s+/g, ' ').replace(/[.\-_]+$/g, '');

      const group: GroupEntry = groups.get(key) || { variants: new Map<string, number>(), itemIds: [] as string[] };
      group.variants.set(original, (group.variants.get(original) || 0) + 1);
      group.itemIds.push(item.id);
      groups.set(key, group);
    }

    // Build clusters from groups that have multiple variant spellings
    const clusters: ConsistencyCluster[] = [];
    for (const group of groups.values()) {
      if (group.variants.size <= 1) continue; // All consistent, skip

      // Pick the most frequent variant as canonical
      let maxCount = 0;
      let canonical = '';
      for (const [variant, count] of group.variants) {
        if (count > maxCount) {
          maxCount = count;
          canonical = variant;
        }
      }

      clusters.push({
        canonical,
        variants: [...group.variants.keys()].filter(v => v !== canonical),
        itemIds: group.itemIds,
      });
    }

    if (clusters.length > 0) {
      results.push({ field: field.name, clusters });
    }
  }

  return results;
}

export async function generateSeoAttributes(
  itemData: any,
  lang: string,
  apiKey: string
): Promise<{ seoData: any; tokensUsed: number }> {
  const prompt = `
    As an SEO expert, generate SEO attributes for the following product data in language "${lang}".
    
    Product Data: ${JSON.stringify(itemData)}
    
    Required Attributes:
    - seo_title: Compelling title tag (60 chars max)
    - seo_description: Engaging meta description (160 chars max)
    - seo_keywords: Comma-separated relevant keywords
    
    Return a JSON object with:
    1. "seo_data": an object where keys are "seo_title", "seo_description", "seo_keywords".
    
    Return ONLY valid JSON.
  `;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json() as any;
    
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] OpenRouter returned no choices or error for SEO:', JSON.stringify(data));
      if (isMockApiKey(apiKey)) {
        console.log('[AI] Using Mock SEO fallback');
        return {
          seoData: {
            seo_title: `Mock Title: ${Object.values(itemData)[0] || 'Product'}`,
            seo_description: `Mock description for ${Object.values(itemData)[0] || 'product'} in ${lang}`,
            seo_keywords: 'mock, e2e, test'
          },
          tokensUsed: 100
        };
      }
      throw new Error(`AI_API_ERROR: ${data.error?.message || 'Unknown error'}`);
    }

    const content = data.choices[0].message.content;
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('AI_PARSE_ERROR: SEO response is not valid JSON');
    }

    const validated = SeoResponseSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[AI] generateSeoAttributes: Zod validation failed:', validated.error.message);
      // Fallback: use raw parsed data
      return {
        seoData: parsed.seo_data || {},
        tokensUsed: data.usage?.total_tokens || 0
      };
    }

    return {
      seoData: validated.data.seo_data,
      tokensUsed: data.usage?.total_tokens || 0
    };
  } catch (error) {
    console.error('Error in generateSeoAttributes:', error);
    throw error;
  }
}

/**
 * Batch-classify collisions with AI to add severity and human-readable explanations.
 * Groups collisions by reason+field to minimize API calls.
 * Returns a map of collision IDs to { severity, explanation }.
 */
export async function classifyCollisionsBatch(
  collisionGroups: { reason: string; field: string; sampleValues: string[]; count: number }[],
  schemaFields: any[],
  apiKey: string,
  catalogContext?: string
): Promise<{ classifications: { reason: string; field: string; severity: string; explanation: string }[] }> {
  if (isMockApiKey(apiKey) || collisionGroups.length === 0) {
    return {
      classifications: collisionGroups.map(g => ({
        reason: g.reason,
        field: g.field,
        severity: g.reason === 'missing_required' ? 'critical' : 'warning',
        explanation: `${g.count} items have ${g.reason} for field "${g.field}"`,
      }))
    };
  }

  const fieldDescriptions = schemaFields.map(f =>
    `- "${f.name}" (${f.fieldType || 'text'}): ${f.description || f.label || f.name}`
  ).join('\n');

  const groupsBlock = collisionGroups.map((g, i) =>
    `${i + 1}. Field: "${g.field}", Reason: "${g.reason}", Count: ${g.count}, Sample values: ${g.sampleValues.slice(0, 3).join(', ')}`
  ).join('\n');

  const contextBlock = catalogContext
    ? `\nCATALOG DOMAIN: ${sanitizePromptInput(catalogContext, 2000)}\n`
    : '';

  const prompt = `You are classifying data quality issues (collisions) found during AI product enrichment.
${contextBlock}
SCHEMA FIELDS:
${fieldDescriptions}

COLLISION GROUPS (each group = many items with the same issue):
${groupsBlock}

For each collision group, provide:
1. "severity": "critical" (blocks export, data is wrong), "warning" (should review, data may be inaccurate), or "info" (minor, acceptable default used)
2. "explanation": Brief human-readable explanation of what went wrong and what the reviewer should do (1-2 sentences, written for a non-technical e-commerce user)

Return a JSON object with a "classifications" array matching the input order.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are a data quality analyst for e-commerce catalogs.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_schema', json_schema: COLLISION_CLASSIFICATION_RESPONSE_SCHEMA }
      })
    });

    const data = await response.json() as any;
    if (!data.choices || data.choices.length === 0) {
      throw new Error(`AI_API_ERROR: ${data.error?.message || 'No choices returned'}`);
    }

    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content);
    return { classifications: parsed.classifications || [] };
  } catch (err) {
    console.warn('[AI] classifyCollisionsBatch failed, using defaults:', err);
    return {
      classifications: collisionGroups.map(g => ({
        reason: g.reason,
        field: g.field,
        severity: g.reason === 'missing_required' ? 'critical' : 'warning',
        explanation: `${g.count} items have ${g.reason} for field "${g.field}"`,
      }))
    };
  }
}

const COLLISION_CLASSIFICATION_RESPONSE_SCHEMA = {
  name: 'collision_classification',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            field: { type: 'string' },
            severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
            explanation: { type: 'string' },
          },
          required: ['reason', 'field', 'severity', 'explanation'],
          additionalProperties: false,
        },
      },
    },
    required: ['classifications'],
    additionalProperties: false,
  },
};
