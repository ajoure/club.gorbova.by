/**
 * Shared custom field token resolver for edge functions.
 * Resolves {{cf.product.<field_uuid>}} tokens using field_values_v2.
 * 
 * No entity_type filter — field_values_v2 has no such column.
 * Uses service_role client to bypass RLS.
 */

const CF_TOKEN_REGEX = /\{\{cf\.product\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\}\}/g;

/**
 * Extract cf.product field UUIDs from template text.
 */
export function extractCustomFieldTokenIds(text: string): string[] {
  if (!text.includes('{{cf.')) return [];
  const matches = text.matchAll(new RegExp(CF_TOKEN_REGEX.source, 'g'));
  const ids = new Set<string>();
  for (const m of matches) {
    ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Resolve {{cf.product.<uuid>}} tokens in text.
 * 
 * @param text - template string
 * @param productId - product entity_id, or null
 * @param supabaseAdmin - service_role client (bypasses RLS)
 * @returns resolved text + metadata
 */
export async function resolveCustomFieldTokens(
  text: string,
  productId: string | null,
  supabaseAdmin: any
): Promise<{ text: string; cfTokensIgnored: boolean; cfFieldIds: string[] }> {
  const fieldIds = extractCustomFieldTokenIds(text);
  
  if (fieldIds.length === 0) {
    return { text, cfTokensIgnored: false, cfFieldIds: [] };
  }

  // No product context → replace all cf tokens with empty string
  if (!productId) {
    const resolved = text.replace(new RegExp(CF_TOKEN_REGEX.source, 'g'), '');
    return { text: resolved, cfTokensIgnored: true, cfFieldIds: fieldIds };
  }

  // Batch load field values for this product (no entity_type filter)
  const { data: values } = await supabaseAdmin
    .from('field_values_v2')
    .select('field_id, value')
    .eq('entity_id', productId)
    .in('field_id', fieldIds);

  const valueMap = new Map<string, any>();
  if (values) {
    for (const v of values) {
      valueMap.set(v.field_id, v.value);
    }
  }

  const resolved = text.replace(new RegExp(CF_TOKEN_REGEX.source, 'g'), (_match: string, uuid: string) => {
    const val = valueMap.get(uuid);
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean') return val ? 'Да' : 'Нет';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });

  return { text: resolved, cfTokensIgnored: false, cfFieldIds: fieldIds };
}
