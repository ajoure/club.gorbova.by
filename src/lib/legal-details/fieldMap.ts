/**
 * LEGAL_DETAILS_FIELD_MAP — single source of truth for mapping
 * fields_registry keys → client_legal_details column names.
 *
 * Used by:
 * - token-resolver (resolve tokens to column values)
 * - useLegalDetailsFields hook (map registry entries to form fields)
 *
 * Key format: namespaced "legal_details.<column>"
 * Value: exact column name in client_legal_details table
 */

export const LEGAL_DETAILS_FIELD_MAP: Record<string, string> = {
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
  // Entrepreneur (ent_*)
  "legal_details.ent_unp": "ent_unp",
  "legal_details.ent_name": "ent_name",
  "legal_details.ent_address": "ent_address",
  "legal_details.ent_acts_on_basis": "ent_acts_on_basis",
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
 * Reverse lookup: column name → registry key.
 * Used by UI to find the registry entry for a given form field.
 */
export const COLUMN_TO_REGISTRY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(LEGAL_DETAILS_FIELD_MAP).map(([k, v]) => [v, k])
);
