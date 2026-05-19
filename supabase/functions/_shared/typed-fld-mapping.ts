// ============================================================================
// typed-fld-mapping.ts — B-97 canonical FLD↔token_key mapping
// ----------------------------------------------------------------------------
// Static SOT-mirror of fields_registry rows for batch
// `placeholders_fld_backfill_B97_2026_05_13` (97 FLDs).
// Used by document-data-snapshot to materialize typed customer/executor values
// into `document_data.fields[FLD-XXXXXX]` so the strict generator finds them.
//
// Source of truth остаётся БД (fields_registry + document_token_registry).
// Этот файл — кэш для офлайн-исполнения snapshot без round-trip в БД.
// Если регистр меняется — обнови этот файл (DoD: 97 entries, batch B-97).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { buildTypedNamespaceValues } from "./typed-tokens-resolver.ts";

/** FLD public_id → typed token_key (97 entries, batch B-97). */
export const B97_FLD_TO_TOKEN_KEY: Record<string, string> = {
  // customer.ent.* (24)
  "FLD-000273": "customer.ent.acts_on_basis",
  "FLD-000274": "customer.ent.address.apartment",
  "FLD-000275": "customer.ent.address.building",
  "FLD-000276": "customer.ent.address.city",
  "FLD-000277": "customer.ent.address.city_district",
  "FLD-000278": "customer.ent.address.country",
  "FLD-000279": "customer.ent.address.district",
  "FLD-000280": "customer.ent.address.full",
  "FLD-000281": "customer.ent.address.house",
  "FLD-000282": "customer.ent.address.postal_code",
  "FLD-000283": "customer.ent.address.region",
  "FLD-000284": "customer.ent.address.street",
  "FLD-000285": "customer.ent.bank_account",
  "FLD-000286": "customer.ent.bank_code",
  "FLD-000287": "customer.ent.bank_name",
  "FLD-000288": "customer.ent.director_acts_on_basis",
  "FLD-000289": "customer.ent.director_full_name",
  "FLD-000290": "customer.ent.director_position",
  "FLD-000291": "customer.ent.director_short_name",
  "FLD-000292": "customer.ent.email",
  "FLD-000293": "customer.ent.name",
  "FLD-000294": "customer.ent.phone",
  "FLD-000295": "customer.ent.short_name",
  "FLD-000296": "customer.ent.unp",
  // customer.ind.* (26)
  "FLD-000297": "customer.ind.address.apartment",
  "FLD-000298": "customer.ind.address.building",
  "FLD-000299": "customer.ind.address.city",
  "FLD-000300": "customer.ind.address.city_district",
  "FLD-000301": "customer.ind.address.country",
  "FLD-000302": "customer.ind.address.district",
  "FLD-000303": "customer.ind.address.full",
  "FLD-000304": "customer.ind.address.house",
  "FLD-000305": "customer.ind.address.postal_code",
  "FLD-000306": "customer.ind.address.region",
  "FLD-000307": "customer.ind.address.street",
  "FLD-000308": "customer.ind.bank_account",
  "FLD-000309": "customer.ind.bank_code",
  "FLD-000310": "customer.ind.bank_name",
  "FLD-000311": "customer.ind.birth_date",
  "FLD-000312": "customer.ind.email",
  "FLD-000313": "customer.ind.full_name",
  "FLD-000314": "customer.ind.full_name_short",
  "FLD-000315": "customer.ind.passport_issued_by",
  "FLD-000316": "customer.ind.passport_issued_date",
  "FLD-000317": "customer.ind.passport_number",
  "FLD-000318": "customer.ind.passport_number_full",
  "FLD-000319": "customer.ind.passport_series",
  "FLD-000320": "customer.ind.passport_valid_until",
  "FLD-000321": "customer.ind.personal_number",
  "FLD-000322": "customer.ind.phone",
  // customer.leg.* (24)
  "FLD-000323": "customer.leg.acts_on_basis",
  "FLD-000324": "customer.leg.address.apartment",
  "FLD-000325": "customer.leg.address.building",
  "FLD-000326": "customer.leg.address.city",
  "FLD-000327": "customer.leg.address.city_district",
  "FLD-000328": "customer.leg.address.country",
  "FLD-000329": "customer.leg.address.district",
  "FLD-000330": "customer.leg.address.full",
  "FLD-000331": "customer.leg.address.house",
  "FLD-000332": "customer.leg.address.postal_code",
  "FLD-000333": "customer.leg.address.region",
  "FLD-000334": "customer.leg.address.street",
  "FLD-000335": "customer.leg.bank_account",
  "FLD-000336": "customer.leg.bank_code",
  "FLD-000337": "customer.leg.bank_name",
  "FLD-000338": "customer.leg.director_full_name",
  "FLD-000339": "customer.leg.director_position",
  "FLD-000340": "customer.leg.director_short_name",
  "FLD-000341": "customer.leg.email",
  "FLD-000342": "customer.leg.name",
  "FLD-000343": "customer.leg.org_form",
  "FLD-000344": "customer.leg.phone",
  "FLD-000345": "customer.leg.short_name",
  "FLD-000346": "customer.leg.unp",
  // executor.leg.* (23 — без org_form, postponed)
  "FLD-000347": "executor.leg.acts_on_basis",
  "FLD-000348": "executor.leg.address.apartment",
  "FLD-000349": "executor.leg.address.building",
  "FLD-000350": "executor.leg.address.city",
  "FLD-000351": "executor.leg.address.city_district",
  "FLD-000352": "executor.leg.address.country",
  "FLD-000353": "executor.leg.address.district",
  "FLD-000354": "executor.leg.address.full",
  "FLD-000355": "executor.leg.address.house",
  "FLD-000356": "executor.leg.address.postal_code",
  "FLD-000357": "executor.leg.address.region",
  "FLD-000358": "executor.leg.address.street",
  "FLD-000359": "executor.leg.bank_account",
  "FLD-000360": "executor.leg.bank_code",
  "FLD-000361": "executor.leg.bank_name",
  "FLD-000362": "executor.leg.director_full_name",
  "FLD-000363": "executor.leg.director_position",
  "FLD-000364": "executor.leg.director_short_name",
  "FLD-000365": "executor.leg.email",
  "FLD-000366": "executor.leg.name",
  "FLD-000367": "executor.leg.phone",
  "FLD-000368": "executor.leg.short_name",
  "FLD-000369": "executor.leg.unp",
};

/**
 * Build FLD public_id → value map for all 97 B-97 typed FLDs.
 * Uses buildTypedNamespaceValues(customer, executor) (SOT for typed values)
 * and translates token_key → FLD via B97_FLD_TO_TOKEN_KEY.
 *
 * Empty strings ARE returned for non-matching subject_type (e.g. customer.leg.*
 * when client_type='individual') — это корректное «нет данных, поле не
 * применимо», а не «отсутствует resolver». Источник в snapshot — typed_b97.
 */
export function buildTypedB97FieldValues(
  customer: any,
  executor: any,
): Record<string, string> {
  const tokenValues = buildTypedNamespaceValues(customer, executor);
  const out: Record<string, string> = {};
  for (const [fld, tokenKey] of Object.entries(B97_FLD_TO_TOKEN_KEY)) {
    out[fld] = tokenValues[tokenKey] ?? "";
  }
  return out;
}

/**
 * Merge typed B-97 values into existing fields. Preserves manual_override.
 * Marks each entry with source='snapshot_typed_b97'.
 */
export function mergeTypedB97IntoFields(
  fields: Record<string, any>,
  values: Record<string, string>,
  nowIso: string,
): { fields: Record<string, any>; written: number; skipped_manual: number; non_empty: number } {
  const out = { ...fields };
  let written = 0;
  let skipped_manual = 0;
  let non_empty = 0;
  for (const [fid, val] of Object.entries(values)) {
    const existing = out[fid];
    if (existing && existing.manual_override === true) {
      skipped_manual += 1;
      continue;
    }
    out[fid] = {
      value: val ?? "",
      source: "snapshot_typed_b97",
      manual_override: false,
      updated_at: nowIso,
    };
    written += 1;
    if (val && val.length > 0) non_empty += 1;
  }
  return { fields: out, written, skipped_manual, non_empty };
}
