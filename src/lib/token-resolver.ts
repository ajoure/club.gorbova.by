/**
 * Token Resolver for Custom Fields (cf.* tokens)
 * Sprint 7a+7c: supports entity_type='product' and 'legal_details'
 * 
 * Token formats:
 *   {{cf.product.<field_id_uuid>}}
 *   {{cf.legal_details.<field_id_uuid>}}
 * 
 * Legal details resolver uses whitelist mapping (LEGAL_DETAILS_FIELD_MAP)
 * and reads directly from client_legal_details structured columns.
 */

import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { LEGAL_DETAILS_FIELD_MAP } from "@/lib/legal-details/fieldMap";

// UUID pattern shared by both token types
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// Strict regex for cf tokens with UUID field_id
const CF_TOKEN_REGEX = new RegExp(
  `\\{\\{cf\\.product\\.(${UUID_PATTERN})\\}\\}`,
  "g"
);

const CF_LEGAL_TOKEN_REGEX = new RegExp(
  `\\{\\{cf\\.legal_details\\.(${UUID_PATTERN})\\}\\}`,
  "g"
);

interface ResolveContext {
  productId?: string;
  legalDetailsId?: string;
}

interface FieldRegistryEntry {
  id: string;
  key: string;
  data_type: string;
}

/**
 * Resolve all {{cf.*}} tokens in a template string.
 * 
 * Contract:
 * - If context.productId is missing → all cf.product tokens → ""
 * - If context.legalDetailsId is missing → all cf.legal_details tokens → ""
 * - If field not found in registry → ""
 * - If no value stored → ""
 * - Supported types: text, number, boolean, date, json
 * - Others: String(value) fallback
 * - No HTML escaping (plain-text only)
 */
export async function resolveTokens(
  template: string,
  context: ResolveContext
): Promise<string> {
  // Quick check: if no cf tokens present, return as-is
  if (!template.includes("{{cf.")) {
    return template;
  }

  let result = template;

  // Resolve product tokens
  result = await resolveProductTokens(result, context.productId);

  // Resolve legal_details tokens
  result = await resolveLegalDetailsTokens(result, context.legalDetailsId);

  return result;
}

/**
 * Resolve {{cf.product.<UUID>}} tokens.
 */
async function resolveProductTokens(template: string, productId?: string): Promise<string> {
  const regex = new RegExp(CF_TOKEN_REGEX.source, "g");
  const fieldIds: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (!fieldIds.includes(match[1])) {
      fieldIds.push(match[1]);
    }
  }

  if (fieldIds.length === 0) return template;

  if (!productId) {
    return template.replace(new RegExp(CF_TOKEN_REGEX.source, "g"), "");
  }

  // Batch load field registry entries for data_type info
  const { data: fieldsData } = await supabase
    .from("fields_registry")
    .select("id, key, data_type")
    .in("id", fieldIds);

  const fieldsMap = new Map<string, FieldRegistryEntry>();
  if (fieldsData) {
    for (const f of fieldsData) {
      fieldsMap.set(f.id, f as FieldRegistryEntry);
    }
  }

  // Batch load field values for this product
  const { data: valuesData } = await supabase
    .from("field_values_v2")
    .select("field_id, value")
    .eq("entity_id", productId)
    .in("field_id", fieldIds);

  const valuesMap = new Map<string, any>();
  if (valuesData) {
    for (const v of valuesData) {
      valuesMap.set(v.field_id, v.value);
    }
  }

  return template.replace(new RegExp(CF_TOKEN_REGEX.source, "g"), (_match, fieldId: string) => {
    const rawValue = valuesMap.get(fieldId);
    if (rawValue === undefined || rawValue === null) return "";

    const field = fieldsMap.get(fieldId);
    if (!field) return "";

    return formatValue(rawValue, field.data_type);
  });
}

/**
 * Resolve {{cf.legal_details.<UUID>}} tokens.
 * Uses whitelist LEGAL_DETAILS_FIELD_MAP for safe column access.
 */
async function resolveLegalDetailsTokens(template: string, legalDetailsId?: string): Promise<string> {
  const regex = new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g");
  const fieldIds: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (!fieldIds.includes(match[1])) {
      fieldIds.push(match[1]);
    }
  }

  if (fieldIds.length === 0) return template;

  if (!legalDetailsId) {
    return template.replace(new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g"), "");
  }

  // Load registry entries to get key → column mapping
  const { data: fieldsData } = await supabase
    .from("fields_registry")
    .select("id, key, data_type")
    .in("id", fieldIds);

  const fieldsMap = new Map<string, FieldRegistryEntry>();
  if (fieldsData) {
    for (const f of fieldsData) {
      fieldsMap.set(f.id, f as FieldRegistryEntry);
    }
  }

  // Collect whitelisted column names we need to read
  const columnsNeeded = new Set<string>();
  for (const field of fieldsMap.values()) {
    const column = LEGAL_DETAILS_FIELD_MAP[field.key];
    if (column) columnsNeeded.add(column);
  }

  if (columnsNeeded.size === 0) {
    return template.replace(new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g"), "");
  }

  // Load the legal details row
  const { data: detailsRow } = await supabase
    .from("client_legal_details")
    .select(Array.from(columnsNeeded).join(", "))
    .eq("id", legalDetailsId)
    .single();

  return template.replace(new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g"), (_match, fieldId: string) => {
    const field = fieldsMap.get(fieldId);
    if (!field) return "";

    const column = LEGAL_DETAILS_FIELD_MAP[field.key];
    if (!column) return "";

    const rawValue = detailsRow?.[column as keyof typeof detailsRow];
    if (rawValue === undefined || rawValue === null) return "";

    return formatValue(rawValue, field.data_type);
  });
}

/**
 * Format a raw field value based on its data_type.
 */
function formatValue(rawValue: any, dataType: string): string {
  switch (dataType) {
    case "text":
      return String(rawValue);

    case "number":
      return String(rawValue);

    case "boolean": {
      const boolVal = rawValue === true || rawValue === "true";
      return boolVal ? "Да" : "Нет";
    }

    case "date": {
      try {
        const parsed = parseISO(String(rawValue));
        return format(parsed, "dd.MM.yyyy");
      } catch {
        return String(rawValue);
      }
    }

    case "json":
      try {
        return typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
      } catch {
        return String(rawValue);
      }

    default:
      // All other types: String fallback
      return String(rawValue);
  }
}
