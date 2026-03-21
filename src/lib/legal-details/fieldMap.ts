/**
 * LEGAL_DETAILS_FIELD_MAP — single source of truth for mapping
 * fields_registry keys → client_legal_details column names.
 *
 * Used by:
 * - token-resolver (resolve tokens to column values)
 * - useLegalDetailsFields hook (map registry entries to form fields)
 *
 * Two mapping types:
 * - Simple: key → column name string (direct column read)
 * - JSONB:  key → { column, jsonPath } (read JSONB column, extract sub-field)
 *
 * Key format: namespaced "legal_details.<column>"
 */

export type FieldMapping =
  | string                              // simple column name
  | { column: string; jsonPath: string }; // JSONB column + sub-field

export const LEGAL_DETAILS_FIELD_MAP: Record<string, FieldMapping> = {
  // Common
  "legal_details.bank_account": "bank_account",
  "legal_details.bank_name": "bank_name",
  "legal_details.bank_code": "bank_code",
  "legal_details.phone": "phone",
  "legal_details.email": "email",
  // Legal entity (leg_*)
  "legal_details.leg_unp": "leg_unp",
  "legal_details.leg_org_form": "leg_org_form",
  "legal_details.leg_name": "leg_name",
  "legal_details.leg_address": "leg_address",
  "legal_details.leg_director_position": "leg_director_position",
  "legal_details.leg_director_name": "leg_director_name",
  "legal_details.leg_acts_on_basis": "leg_acts_on_basis",
  // ЮЛ structured address sub-fields (JSONB)
  "legal_details.leg_address_street":      { column: "leg_address_structured", jsonPath: "street" },
  "legal_details.leg_address_house":       { column: "leg_address_structured", jsonPath: "house" },
  "legal_details.leg_address_building":    { column: "leg_address_structured", jsonPath: "building" },
  "legal_details.leg_address_apartment":   { column: "leg_address_structured", jsonPath: "apartment" },
  "legal_details.leg_address_city":        { column: "leg_address_structured", jsonPath: "city" },
  "legal_details.leg_address_region":      { column: "leg_address_structured", jsonPath: "region" },
  "legal_details.leg_address_postal_code": { column: "leg_address_structured", jsonPath: "postal_code" },
  "legal_details.leg_address_country":     { column: "leg_address_structured", jsonPath: "country" },
  // Entrepreneur (ent_*)
  "legal_details.ent_unp": "ent_unp",
  "legal_details.ent_name": "ent_name",
  "legal_details.ent_address": "ent_address",
  "legal_details.ent_acts_on_basis": "ent_acts_on_basis",
  // ИП structured address sub-fields (JSONB)
  "legal_details.ent_address_street":      { column: "ent_address_structured", jsonPath: "street" },
  "legal_details.ent_address_house":       { column: "ent_address_structured", jsonPath: "house" },
  "legal_details.ent_address_building":    { column: "ent_address_structured", jsonPath: "building" },
  "legal_details.ent_address_apartment":   { column: "ent_address_structured", jsonPath: "apartment" },
  "legal_details.ent_address_city":        { column: "ent_address_structured", jsonPath: "city" },
  "legal_details.ent_address_region":      { column: "ent_address_structured", jsonPath: "region" },
  "legal_details.ent_address_postal_code": { column: "ent_address_structured", jsonPath: "postal_code" },
  "legal_details.ent_address_country":     { column: "ent_address_structured", jsonPath: "country" },
  // Individual (ind_*)
  "legal_details.ind_full_name": "ind_full_name",
  "legal_details.ind_birth_date": "ind_birth_date",
  "legal_details.ind_passport_series": "ind_passport_series",
  "legal_details.ind_passport_number": "ind_passport_number",
  "legal_details.ind_passport_issued_by": "ind_passport_issued_by",
  "legal_details.ind_passport_issued_date": "ind_passport_issued_date",
  "legal_details.ind_passport_valid_until": "ind_passport_valid_until",
  "legal_details.ind_personal_number": "ind_personal_number",
  "legal_details.ind_address_index": "ind_address_index",
  "legal_details.ind_address_region": "ind_address_region",
  "legal_details.ind_address_district": "ind_address_district",
  "legal_details.ind_address_city": "ind_address_city",
  "legal_details.ind_address_street": "ind_address_street",
  "legal_details.ind_address_house": "ind_address_house",
  "legal_details.ind_address_apartment": "ind_address_apartment",
};

/**
 * Helper: get the column name from a field mapping (simple or JSONB).
 */
export function getColumnFromMapping(mapping: FieldMapping): string {
  return typeof mapping === "string" ? mapping : mapping.column;
}

/**
 * Helper: check if a mapping is JSONB (has jsonPath).
 */
export function isJsonbMapping(mapping: FieldMapping): mapping is { column: string; jsonPath: string } {
  return typeof mapping !== "string";
}

/**
 * Reverse lookup: column name → registry key.
 * Only works for simple (non-JSONB) mappings.
 * Used by UI to find the registry entry for a given form field.
 */
export const COLUMN_TO_REGISTRY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(LEGAL_DETAILS_FIELD_MAP)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => [v as string, k])
);
