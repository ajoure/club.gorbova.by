/**
 * Token Resolver for Custom Fields (cf.* tokens)
 * Sprint 7a+7c+7d: supports entity_type='product' and 'legal_details'
 * 
 * Token formats:
 *   {{cf.product.<field_id_uuid>}}          — legacy UUID-based (product)
 *   {{cf.legal_details.<FLD-XXXXXX>}}       — canonical public_id-based
 *   {{cf.legal_details.<field_id_uuid>}}    — compatibility layer (legacy)
 * 
 * Legal details resolver:
 *   1. Extracts identifier from token (FLD-* or UUID)
 *   2. Looks up fields_registry by public_id (canonical) or id (legacy)
 *   3. Uses LEGAL_DETAILS_FIELD_MAP whitelist for safe column access
 *   4. Reads from client_legal_details (simple columns or JSONB sub-fields)
 */

import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { LEGAL_DETAILS_FIELD_MAP, isJsonbMapping, getColumnFromMapping } from "@/lib/legal-details/fieldMap";

// UUID pattern for product tokens
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// Strict regex for cf tokens with UUID field_id
const CF_TOKEN_REGEX = new RegExp(
  `\\{\\{cf\\.product\\.(${UUID_PATTERN})\\}\\}`,
  "g"
);

// Legal details tokens: FLD-XXXXXX (canonical) OR UUID (compatibility layer)
const FLD_ID_PATTERN = "FLD-\\d+";
const CF_LEGAL_TOKEN_REGEX = new RegExp(
  `\\{\\{cf\\.legal_details\\.(${FLD_ID_PATTERN}|${UUID_PATTERN})\\}\\}`,
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
  public_id: string;
}

/**
 * Resolve all {{cf.*}} tokens in a template string.
 */
export async function resolveTokens(
  template: string,
  context: ResolveContext
): Promise<string> {
  if (!template.includes("{{cf.")) {
    return template;
  }

  let result = template;
  result = await resolveProductTokens(result, context.productId);
  result = await resolveLegalDetailsTokens(result, context.legalDetailsId);
  return result;
}

/**
 * Resolve {{cf.product.<UUID>}} tokens (unchanged legacy).
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
 * Resolve {{cf.legal_details.<FLD-XXXXXX>}} (canonical) and
 * {{cf.legal_details.<UUID>}} (compatibility layer) tokens.
 *
 * Resolution path:
 *   token(public_id or uuid)
 *   → fields_registry lookup (by public_id or id)
 *   → fields_registry.key
 *   → LEGAL_DETAILS_FIELD_MAP whitelist
 *   → client_legal_details[column] or client_legal_details[jsonb_column][jsonPath]
 *   → formatted value
 */
async function resolveLegalDetailsTokens(template: string, legalDetailsId?: string): Promise<string> {
  const regex = new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g");
  const identifiers: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (!identifiers.includes(match[1])) {
      identifiers.push(match[1]);
    }
  }

  if (identifiers.length === 0) return template;

  if (!legalDetailsId) {
    return template.replace(new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g"), "");
  }

  // Separate FLD-* (public_id) from UUID (legacy) identifiers
  const publicIds = identifiers.filter(id => id.startsWith("FLD-"));
  const uuidIds = identifiers.filter(id => !id.startsWith("FLD-"));

  // Batch load registry entries by public_id and/or id
  const fieldsMap = new Map<string, FieldRegistryEntry>(); // identifier → entry

  if (publicIds.length > 0) {
    const { data } = await supabase
      .from("fields_registry")
      .select("id, key, data_type, public_id")
      .in("public_id", publicIds);
    if (data) {
      for (const f of data) {
        fieldsMap.set(f.public_id!, f as FieldRegistryEntry);
      }
    }
  }

  if (uuidIds.length > 0) {
    const { data } = await supabase
      .from("fields_registry")
      .select("id, key, data_type, public_id")
      .in("id", uuidIds);
    if (data) {
      for (const f of data) {
        fieldsMap.set(f.id, f as FieldRegistryEntry);
      }
    }
  }

  // Collect all columns we need to read from client_legal_details
  const columnsNeeded = new Set<string>();
  for (const field of fieldsMap.values()) {
    const mapping = LEGAL_DETAILS_FIELD_MAP[field.key];
    if (mapping) {
      columnsNeeded.add(getColumnFromMapping(mapping));
    }
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

  return template.replace(new RegExp(CF_LEGAL_TOKEN_REGEX.source, "g"), (_match, identifier: string) => {
    const field = fieldsMap.get(identifier);
    if (!field) return "";

    const mapping = LEGAL_DETAILS_FIELD_MAP[field.key];
    if (!mapping) return "";

    let rawValue: any;

    if (isJsonbMapping(mapping)) {
      // JSONB sub-field: read column as object, extract jsonPath
      const jsonCol = detailsRow?.[mapping.column as keyof typeof detailsRow];
      if (jsonCol && typeof jsonCol === "object") {
        rawValue = (jsonCol as Record<string, any>)[mapping.jsonPath];
      }
    } else {
      // Simple column
      rawValue = detailsRow?.[mapping as keyof typeof detailsRow];
    }

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
      return String(rawValue);
  }
}
