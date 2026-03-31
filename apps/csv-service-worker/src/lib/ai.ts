import { SchemaField } from '@ecom-kit/shared-types';

export interface CatalogAnalysis {
  categories: { name: string; attributes: string[]; exampleProducts: string[] }[];
  totalTokensUsed: number;
}

/**
 * Stage A: Analyse a product catalog to identify distinct categories/niches
 * and their key commercial + technical attributes.
 * Uses gpt-4o for higher quality (single call per upload).
 */
export async function analyseProductCatalog(
  sampleRows: any[],
  apiKey: string,
  catalogContext?: string
): Promise<CatalogAnalysis> {
  if (apiKey.includes('mock') || sampleRows.length === 0) {
    return { categories: [], totalTokensUsed: 0 };
  }

  const rowsBlock = sampleRows.map((row, i) => {
    const lines = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    return `--- Product ${i + 1} ---\n${lines}`;
  }).join('\n\n');

  const contextLine = catalogContext
    ? `\nMERCHANT-PROVIDED DOMAIN CONTEXT:\n${catalogContext}\n`
    : '';

  const prompt = `You are a senior product catalog analyst. Study the sample products below and identify ALL distinct product categories or niches present in this catalog.
${contextLine}
SAMPLE PRODUCTS:
${rowsBlock}

YOUR TASK:
1. Identify every distinct product category/niche represented in the data above
2. For each category, list the key commercial and technical attributes that are specific to that niche (e.g. "puff_count" for disposable vapes, "volume_ml" for liquids, "screen_size" for electronics)
3. Name 1-2 example products from the data that belong to each category

Respond ONLY with valid JSON:
{
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

    const cats = Array.isArray(parsed.categories) ? parsed.categories : [];
    const categories = cats.map((c: any) => ({
      name: String(c.name || ''),
      attributes: Array.isArray(c.attributes) ? c.attributes.map(String) : [],
      exampleProducts: Array.isArray(c.example_products) ? c.example_products.map(String) : [],
    })).filter((c: any) => c.name);

    console.log(`[AI] analyseProductCatalog: found ${categories.length} categories`);
    return { categories, totalTokensUsed: data.usage?.total_tokens || 0 };
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
  catalogAnalysis?: CatalogAnalysis
): Promise<{ fields: Partial<any>[]; tokensUsed: number }> {
  // Explicit dev/test mode — only use mock when key is intentionally fake
  if (apiKey.includes('mock')) {
    console.log('[AI] Mock API key detected, returning fallback schema for dev/test');
    return { fields: _mockSchemaFallback(headers), tokensUsed: 0 };
  }

  const existingColumns = headers.join(', ');

  // Render sample rows as readable key:value blocks so the model treats every
  // field — especially long description fields — as meaningful signal.
  const sampleBlock = sampleData.map((row, i) => {
    const lines = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    return `--- Product ${i + 1} ---\n${lines}`;
  }).join('\n\n');

  const categoriesBlock = uniqueCategories.length > 0
    ? `\nPRODUCT CATEGORIES FOUND IN THIS CATALOG:\n${uniqueCategories.map(c => `- ${c}`).join('\n')}`
    : '';

  const contextBlock = catalogContext
    ? `\nCATALOG DOMAIN CONTEXT (provided by the merchant):\n${catalogContext}\n`
    : '';

  // Stage A analysis results — when available, gives the model a pre-analysed
  // breakdown of categories and their key attributes, leading to better field proposals.
  let analysisBlock = '';
  if (catalogAnalysis && catalogAnalysis.categories.length > 0) {
    const catLines = catalogAnalysis.categories.map(c =>
      `• ${c.name}\n  Key attributes: ${c.attributes.join(', ')}\n  Examples: ${c.exampleProducts.join(', ')}`
    ).join('\n');
    analysisBlock = `\nPRE-ANALYSED CATALOG STRUCTURE (from Stage A analysis — use this to ensure coverage of ALL niches):\n${catLines}\n`;
  }

  const prompt = `You are a senior E-commerce catalog specialist. Propose enrichment fields based on a thorough catalog analysis.
${contextBlock}${analysisBlock}
EXISTING CSV COLUMNS (already present — do NOT suggest these):
${existingColumns}
${categoriesBlock}

SAMPLE PRODUCT DATA (${sampleData.length} diverse rows — read descriptions carefully, they contain the richest product context):
${sampleBlock}

YOUR TASK:
Based on the catalog analysis and sample data above, propose enrichment fields that cover ALL identified product categories.

REQUIREMENTS:
1. Propose 12-25 fields total:
   - UNIVERSAL fields applicable to all products (brand, product_type, etc.)
   - CATEGORY-SPECIFIC fields for each niche identified in the analysis — include the field's "description" to note which categories it applies to
2. Every field must be reliably extractable or inferable from product names and descriptions using AI
3. Every field must add real e-commerce value: filtering, search, logistics, compliance, or recommendations
4. If two categories share a similar concept (e.g. "volume" for liquids and "capacity" for tanks), DEDUPLICATE into a single field with a clear description covering both uses
5. Suggest fields specific to what you see in the data — do NOT use generic fallbacks

THINK IN THESE DIMENSIONS:
- Physical: brand, color, material, dimensions, weight
- Technical: category-specific specs drawn from the analysis above
- Commercial: age_restriction, product_type, target use, certifications
- Catalog: product_line, compatibility, pack_quantity, country_of_origin

Respond ONLY with valid JSON:
{
  "fields": [
    {
      "name": "snake_case_key",
      "label": "Human Readable Label",
      "field_type": "text|number|boolean|enum",
      "description": "What this field captures, how to infer it, and which categories it applies to",
      "allowed_values": ["val1", "val2"]
    }
  ]
}
"allowed_values" only for enum fields. Omit for other types.`;

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
        { role: 'system', content: 'You are a product data enrichment expert. Respond with valid JSON only, no markdown.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
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

  const fields = parsed.fields ?? parsed.suggested_fields ?? parsed.schema ?? (Array.isArray(parsed) ? parsed : null);
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error(`AI_FORMAT_ERROR: Fields array missing or empty. Response keys: ${Object.keys(parsed).join(', ')}`);
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
export async function generateFewShotExamples(
  sampleRows: any[],
  schemaFields: any[],
  apiKey: string,
  catalogContext?: string
): Promise<string> {
  if (apiKey.includes('mock') || sampleRows.length === 0 || schemaFields.length === 0) {
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
      .map(([k, v]) => `    ${k}: ${v}`)
      .join('\n');
    return `  --- Product ${i + 1} ---\n${lines}`;
  }).join('\n\n');

  const contextLine = catalogContext ? `\nCatalog domain: ${catalogContext}\n` : '';

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
  fewShotExamples?: string
): Promise<{ enrichedData: any; confidence: number; tokensUsed: number }> {
  const fieldNames = schemaFields.map(f => f.name);
  const schemaDescription = schemaFields.map(f => {
    let desc = `- "${f.name}" (${f.fieldType || 'text'}): ${f.description || f.label || f.name}`;
    if (Array.isArray(f.allowedValues) && f.allowedValues.length) {
      desc += `. MUST be one of: ${f.allowedValues.join(', ')}`;
    }
    return desc;
  }).join('\n');

  // Build a human-readable breakdown of the row so the AI treats every field
  // as meaningful signal, regardless of how the CSV column was originally named.
  const rowContext = Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const contextBlock = catalogContext
    ? `\nCATALOG DOMAIN: ${catalogContext}\n`
    : '';

  const fewShotBlock = fewShotExamples
    ? `\nFEW-SHOT EXAMPLES (use these as reference for inference style, value format, and field coverage):\n${fewShotExamples}\n`
    : '';

  const prompt = `You are an E-commerce product data enrichment engine. Your job is to fill in product attributes by extracting or intelligently inferring values from the raw product data.
${contextBlock}
The product data may be in any language (including Russian). Read and understand EVERY field — product name, description, and category all contain important clues.
${fewShotBlock}
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
6. For text fields: return a concise string. Match the language of the input data.
7. NEVER return null or omit a field. If genuinely unknown, return the most plausible default for this product type and niche.

Return ONLY this JSON (no markdown):
{
  "reasoning": "<1-3 sentence analysis of product type, brand, and key specs>",
  "enriched_data": {
${fieldNames.map(n => `    "${n}": <value>`).join(',\n')}
  },
  "confidence": <integer 60-100>
}`;

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
          { role: 'system', content: 'You are a data enrichment engine with deep knowledge of e-commerce product catalogs. Always respond with valid JSON only, no markdown.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json() as any;
    
    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] enrichItem: OpenRouter returned no choices:', JSON.stringify(data).slice(0, 300));
      
      // Fallback for E2E testing without real key
      if (apiKey.includes('mock')) {
        console.log('[AI] Using Mock Enrichment fallback');
        // Copy the original CSV row data directly — schema field names may not
        // match CSV column names, so looking up row[f.name] is always undefined.
        const mockEnriched: any = { ...row };
        schemaFields.forEach(f => {
          if (mockEnriched[f.name] === undefined) {
            mockEnriched[f.name] = f.fieldType === 'number' ? 100 : `[mock] ${f.label || f.name}`;
          }
        });
        return {
          enrichedData: mockEnriched,
          confidence: 95,
          tokensUsed: 150
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

    // Normalize: AI might return enriched data under different keys or at root level
    let enrichedData: any = parsed.enriched_data ?? parsed.enrichedData ?? parsed.data ?? parsed.fields ?? null;

    if (!enrichedData || typeof enrichedData !== 'object' || Array.isArray(enrichedData)) {
      // Fallback: treat the root object as the enriched data (excluding the confidence field)
      const { confidence: _c, ...rest } = parsed;
      if (Object.keys(rest).length > 0) {
        console.warn('[AI] enrichItem: enriched_data key missing, using root object as enriched data');
        enrichedData = rest;
      } else {
        enrichedData = {};
      }
    }

    return {
      enrichedData,
      // Default to 70 (inferred) when AI omits confidence — avoid false collision flood
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 70,
      tokensUsed: data.usage?.total_tokens || 0
    };
  } catch (error) {
    console.error('Error in enrichItem:', error);
    throw error;
  }
}

/**
 * Coerce AI output to match declared field types and validate enum values.
 * Returns corrected data and a list of enum violations (value not in allowedValues).
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

    if (type === 'number') {
      const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''));
      data[field.name] = isNaN(num) ? null : num;

    } else if (type === 'boolean') {
      if (typeof raw !== 'boolean') {
        const s = String(raw).toLowerCase().trim();
        data[field.name] = s === 'true' || s === '1' || s === 'yes' || s === 'да';
      }

    } else if (type === 'text' || type === 'url') {
      data[field.name] = String(raw).trim();

    } else if (type === 'enum') {
      const allowed: string[] = Array.isArray(field.allowedValues) ? field.allowedValues : [];
      if (allowed.length > 0) {
        const actual = String(raw).trim();
        const normalised = actual.toLowerCase();
        // Exact case-insensitive match → normalise to canonical casing
        const canonical = allowed.find(v => v.toLowerCase() === normalised);
        if (canonical) {
          data[field.name] = canonical;
        } else {
          // Value not in allowed set — flag as violation
          enumViolations.push({ field: field.name, value: actual, allowedValues: allowed });
        }
      }
    }
  }

  return { data, enumViolations };
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
      if (apiKey.includes('mock')) {
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
    const parsed = JSON.parse(content);
    
    return {
      seoData: parsed.seo_data || {},
      tokensUsed: data.usage?.total_tokens || 0
    };
  } catch (error) {
    console.error('Error in generateSeoAttributes:', error);
    throw error;
  }
}
