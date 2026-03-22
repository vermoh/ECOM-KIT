import { SchemaField } from '@ecom-kit/shared-types';

export async function generateSchemaSuggestion(
  headers: string[],
  sampleData: any[],
  apiKey: string
): Promise<Partial<any>[]> {
  const prompt = `
    As an E-commerce product data expert, analyze the following CSV headers and sample data.
    Suggest a set of characteristics (schema fields) for these products.
    
    Headers: ${headers.join(', ')}
    Sample Data (first 3 rows): ${JSON.stringify(sampleData.slice(0, 3))}
    
    For each field, provide:
    - name: machine key (snake_case)
    - label: human readable name
    - field_type: one of [text, number, boolean, enum, url]
    - is_required: boolean
    - description: what this field represents
    - allowed_values: array of strings (only if field_type is enum)
    
    Return ONLY a JSON array of objects.
  `;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo', // Or any other suitable model
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json() as any;
    const content = data.choices[0].message.content;
    
    // Parse the JSON array from the response
    const suggestedFields = JSON.parse(content);
    return Array.isArray(suggestedFields) ? suggestedFields : (suggestedFields.fields || []);
  } catch (error) {
    console.error('Error calling OpenRouter:', error);
    // Fallback: return basic fields from headers
    return headers.map(h => ({
      name: h.toLowerCase().replace(/[^a-z0-0]/g, '_'),
      label: h,
      field_type: 'text',
      is_required: false,
      description: `Imported from column ${h}`
    }));
  }
}

export async function enrichItem(
  row: any,
  schemaFields: any[],
  apiKey: string
): Promise<{ enrichedData: any; confidence: number; tokensUsed: number }> {
  const schemaDescription = schemaFields.map(f => 
    `- ${f.name} (${f.fieldType}): ${f.description || ''}${f.allowedValues ? ' Allowed: ' + f.allowedValues.join(',') : ''}`
  ).join('\n');

  const prompt = `
    As an E-commerce product data expert, enrich the following SKU data according to the provided schema.
    
    SKU Raw Data: ${JSON.stringify(row)}
    
    Target Schema:
    ${schemaDescription}
    
    For each field in the schema, extract or infer the value from the raw data.
    If a value cannot be found or inferred, return null for that field.
    
    Return a JSON object with:
    1. "enriched_data": an object where keys are field names and values are the enriched values.
    2. "confidence": an integer from 0 to 100 representing your overall confidence in this enrichment.
    
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
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content);
    
    return {
      enrichedData: parsed.enriched_data || {},
      confidence: parsed.confidence || 0,
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
