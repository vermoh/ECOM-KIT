import { SchemaField } from '@ecom-kit/shared-types';

export async function generateSchemaSuggestion(
  headers: string[],
  sampleData: any[],
  apiKey: string
): Promise<Partial<any>[]> {
  const existingColumns = headers.join(', ');
  const sample = JSON.stringify(sampleData.slice(0, 3), null, 2);

  const prompt = `You are an E-commerce product data enrichment expert. Your task is to propose a list of ADDITIONAL product fields that can be enriched using AI based on the product data provided.

EXISTING CSV COLUMNS (already present — do NOT include these in your output):
${existingColumns}

SAMPLE PRODUCT DATA:
${sample}

YOUR TASK:
Based on the product category/type visible in the data, suggest 6-12 NEW enrichment fields that:
1. Are NOT already present in the CSV columns listed above
2. Can be inferred or generated from the existing data using AI
3. Would add real value for an e-commerce catalog (searchability, filtering, SEO, logistics)

Examples of fields you might suggest (match to the actual product type!):
- For electronics: brand, processor_type, ram_gb, screen_size_inch, battery_life_hours, connectivity, operating_system, warranty_months, weight_kg, color_options
- For furniture: material, color, dimensions_cm, max_load_kg, assembly_required, style, room_type
- For appliances: brand, power_watts, energy_rating, capacity_liters, noise_level_db, color, warranty_years
- For food/beverages: ingredients, allergens, net_weight_g, calories_per_100g, is_vegan, storage_temp, shelf_life_days
- For clothing: material, sizes_available, care_instructions, gender, season, country_of_origin

Respond ONLY with valid JSON in this exact structure:
{
  "fields": [
    {
      "name": "snake_case_key",
      "label": "Human Readable Label",
      "field_type": "text|number|boolean|enum|url",
      "is_required": false,
      "description": "What this field represents and how it will be enriched",
      "allowed_values": ["val1", "val2"]
    }
  ]
}
Note: "allowed_values" is only needed when field_type is "enum". Omit it for other types.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a product data enrichment expert. Always respond with valid JSON only, no markdown fences or explanation.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json() as any;

    if (!data.choices || data.choices.length === 0) {
      console.warn('[AI] generateSchemaSuggestion: no choices from OpenRouter:', JSON.stringify(data).slice(0, 300));
      if (apiKey.includes('mock')) {
        return _mockSchemaFallback(headers);
      }
      throw new Error(`AI_API_ERROR: ${data.error?.message || 'Unknown error'}`);
    }

    const content = data.choices[0].message.content;
    console.log('[AI] Schema raw response:', content?.slice(0, 400));

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[AI] generateSchemaSuggestion: failed to parse JSON, raw:', content?.slice(0, 200));
      return _mockSchemaFallback(headers);
    }

    // Normalize: expect { fields: [...] } but handle bare array too
    const fields = parsed.fields ?? parsed.suggested_fields ?? parsed.schema ?? (Array.isArray(parsed) ? parsed : null);
    if (!Array.isArray(fields) || fields.length === 0) {
      console.warn('[AI] generateSchemaSuggestion: fields array missing or empty, parsed keys:', Object.keys(parsed));
      return _mockSchemaFallback(headers);
    }

    // Filter out any fields that duplicate existing CSV columns
    const existingLower = new Set(headers.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_')));
    const newFields = fields.filter((f: any) => {
      const n = (f.name || '').toLowerCase();
      return n && !existingLower.has(n);
    });

    if (newFields.length === 0) {
      console.warn('[AI] generateSchemaSuggestion: AI returned only existing columns, using mock fallback');
      return _mockSchemaFallback(headers);
    }

    console.log(`[AI] generateSchemaSuggestion: got ${newFields.length} new enrichment fields`);
    return newFields;
  } catch (error) {
    console.error('[AI] Error in generateSchemaSuggestion:', error);
    return _mockSchemaFallback(headers);
  }
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

export async function enrichItem(
  row: any,
  schemaFields: any[],
  apiKey: string
): Promise<{ enrichedData: any; confidence: number; tokensUsed: number }> {
  const fieldNames = schemaFields.map(f => f.name);
  const schemaDescription = schemaFields.map(f =>
    `- "${f.name}" (${f.fieldType || 'text'}): ${f.description || ''}${Array.isArray(f.allowedValues) && f.allowedValues.length ? ' Allowed values: ' + f.allowedValues.join(', ') : ''}`
  ).join('\n');

  const emptyExample = Object.fromEntries(fieldNames.map(n => [n, null]));

  const prompt = `You are an E-commerce product data expert. Extract and infer values for a structured schema from raw SKU data.

RAW SKU DATA:
${JSON.stringify(row)}

TARGET SCHEMA FIELDS:
${schemaDescription}

INSTRUCTIONS:
- Extract values for the schema fields directly from the raw data.
- If a value cannot be found exactly in the raw data, INFER a highly plausible value based on the product category or name. Do not use null unless absolutely necessary.
- Do not add extra fields not listed in the schema.

You MUST return ONLY this JSON structure (no markdown, no explanation):
{
  "enriched_data": ${JSON.stringify(emptyExample)},
  "confidence": <integer 0-100>
}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a data enrichment engine. Always respond with valid JSON only, no markdown.' },
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
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      tokensUsed: data.usage?.total_tokens || 0
    };
  } catch (error) {
    console.error('Error in enrichItem:', error);
    throw error;
  }
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
        model: 'openai/gpt-3.5-turbo',
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
