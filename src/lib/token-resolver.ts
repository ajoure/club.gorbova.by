/**
 * Token Resolver for Custom Fields (cf.* tokens)
 * Sprint 7a: supports only entity_type='product'
 * 
 * Token format: {{cf.product.<field_id_uuid>}}
 * where field_id_uuid is a standard UUID (8-4-4-4-12)
 */

import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";

// Strict regex for cf tokens with UUID field_id
const CF_TOKEN_REGEX = /\{\{cf\.product\.([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}\}/g;

interface ResolveContext {
  productId?: string;
}

interface FieldRegistryEntry {
  id: string;
  data_type: string;
}

/**
 * Resolve all {{cf.product.<field_uuid>}} tokens in a template string.
 * 
 * Contract:
 * - If context.productId is missing → all cf.product tokens → ""
 * - If field not found in registry → ""
 * - If no value stored → ""
 * - Supported types: text, number, boolean, date, json
 * - Others: String(value) fallback
 * - No HTML escaping (plain-text only in Sprint 7a)
 */
export async function resolveTokens(
  template: string,
  context: ResolveContext
): Promise<string> {
  // Quick check: if no cf tokens present, return as-is
  if (!template.includes("{{cf.")) {
    return template;
  }

  // Extract all field_ids from template
  const fieldIds: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(CF_TOKEN_REGEX.source, "g");
  
  while ((match = regex.exec(template)) !== null) {
    if (!fieldIds.includes(match[1])) {
      fieldIds.push(match[1]);
    }
  }

  if (fieldIds.length === 0) {
    return template;
  }

  // If no productId in context → replace all valid cf.product tokens with ""
  if (!context.productId) {
    return template.replace(CF_TOKEN_REGEX, "");
  }

  // Batch load field registry entries for data_type info
  const { data: fieldsData } = await supabase
    .from("fields_registry")
    .select("id, data_type")
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
    .eq("entity_id", context.productId)
    .in("field_id", fieldIds);

  const valuesMap = new Map<string, any>();
  if (valuesData) {
    for (const v of valuesData) {
      valuesMap.set(v.field_id, v.value);
    }
  }

  // Replace tokens
  return template.replace(CF_TOKEN_REGEX, (_match, fieldId: string) => {
    const rawValue = valuesMap.get(fieldId);
    
    // No value stored → empty string
    if (rawValue === undefined || rawValue === null) {
      return "";
    }

    const field = fieldsMap.get(fieldId);
    if (!field) {
      // Field not in registry → empty string
      return "";
    }

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
