/**
 * Requisites v2 — canonical field maps and legacy normalization.
 *
 * Source of truth for canonical keys per subject_type:
 *  - legal_entity (15 fields)
 *  - entrepreneur (10 fields)
 *  - individual   (16 fields)
 *
 * Plus GRP-extension keys (read-only, surfaced in UI when present).
 *
 * Why this file exists:
 * Stage B+C migration copied legacy `client_legal_details` rows into the new
 * `legal_entities_requisites.data` / `individual_requisites.data` jsonb as-is,
 * with old keys (leg_*, ent_*, ind_*, purpose, ...). Forms must read those
 * legacy keys and write back ONLY canonical ones. Unknown keys are preserved
 * to avoid silent data loss.
 *
 * No AI / ai wording allowed in this module (new code).
 */

export const LEGAL_ENTITY_CANONICAL_KEYS = [
  "org_form",
  "name",
  "short_name",
  "unp",
  "address",
  "address_structured",
  "director_position",
  "director_full_name",
  "director_short_name",
  "acts_on_basis",
  "bank_account",
  "bank_name",
  "bank_code",
  "phone",
  "email",
] as const;

export const ENTREPRENEUR_CANONICAL_KEYS = [
  "name",
  "short_name",
  "unp",
  "address",
  "address_structured",
  "acts_on_basis",
  "bank_account",
  "bank_name",
  "bank_code",
  "phone",
  "email",
] as const;

export const INDIVIDUAL_CANONICAL_KEYS = [
  "full_name",
  "birth_date",
  "personal_number",
  "passport_series",
  "passport_number",
  "passport_number_full",
  "passport_issued_by",
  "passport_issued_date",
  "passport_valid_until",
  "address",
  "address_structured",
  "bank_account",
  "bank_name",
  "bank_code",
  "phone",
  "email",
] as const;

export const GRP_KEYS = [
  "grp_registration_date",
  "grp_tax_office_code",
  "grp_tax_office_name",
  "grp_status_code",
  "grp_status_name",
  "grp_short_name",
  "grp_liquidation_date",
  "grp_liquidation_reason",
  "grp_last_fetched_at",
] as const;

/**
 * Service / legacy keys that MUST be stripped on write.
 * They were copied verbatim from old `client_legal_details` rows during the
 * B+C migration but make no sense in the new model.
 */
const SERVICE_LEGACY_KEYS = new Set<string>([
  "purpose",
  "status",
  "validation_status",
  "validation_errors",
  "validated_at",
  "client_type",
  "is_default",
  "id",
  "profile_id",
  "created_at",
  "updated_at",
]);

/** Legacy → canonical for ЮЛ. */
export const LEGAL_ENTITY_REQUISITES_FIELD_MAP: Record<string, string> = {
  leg_org_form: "org_form",
  leg_name: "name",
  leg_short_name: "short_name",
  leg_unp: "unp",
  leg_address: "address",
  leg_address_structured: "address_structured",
  leg_director_position: "director_position",
  leg_director_name: "director_full_name",
  leg_director_full_name: "director_full_name",
  leg_director_short_name: "director_short_name",
  leg_acts_on_basis: "acts_on_basis",
};

/** Legacy → canonical for ИП. */
export const ENTREPRENEUR_REQUISITES_FIELD_MAP: Record<string, string> = {
  ent_name: "name",
  ent_short_name: "short_name",
  ent_unp: "unp",
  ent_address: "address",
  ent_address_structured: "address_structured",
  ent_acts_on_basis: "acts_on_basis",
};

/** Legacy → canonical for ФЛ. */
export const INDIVIDUAL_REQUISITES_FIELD_MAP: Record<string, string> = {
  ind_full_name: "full_name",
  ind_birth_date: "birth_date",
  ind_personal_number: "personal_number",
  ind_passport_series: "passport_series",
  ind_passport_number: "passport_number",
  ind_passport_number_full: "passport_number_full",
  ind_passport_issued_by: "passport_issued_by",
  ind_passport_issued_date: "passport_issued_date",
  ind_passport_valid_until: "passport_valid_until",
  ind_address_structured: "address_structured",
};

export type SubjectKind = "legal_entity" | "entrepreneur" | "individual";

function mapForSubject(subject: SubjectKind): Record<string, string> {
  if (subject === "legal_entity") return LEGAL_ENTITY_REQUISITES_FIELD_MAP;
  if (subject === "entrepreneur") return ENTREPRENEUR_REQUISITES_FIELD_MAP;
  return INDIVIDUAL_REQUISITES_FIELD_MAP;
}

function canonicalKeysForSubject(subject: SubjectKind): readonly string[] {
  if (subject === "legal_entity") return LEGAL_ENTITY_CANONICAL_KEYS;
  if (subject === "entrepreneur") return ENTREPRENEUR_CANONICAL_KEYS;
  return INDIVIDUAL_CANONICAL_KEYS;
}

/**
 * normalizeLegacyData — read-side normalizer.
 *
 * For every legacy key found in `data`, copy its value into the matching
 * canonical key, **only if the canonical key is missing or empty**.
 * Always preserve unknown keys (forward-compat / data-loss safety).
 *
 * Returns a new object — never mutates input.
 */
export function normalizeLegacyData(
  subject: SubjectKind,
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const src = (data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const map = mapForSubject(subject);

  for (const [legacy, canonical] of Object.entries(map)) {
    const legacyVal = src[legacy];
    if (legacyVal === undefined || legacyVal === null || legacyVal === "") continue;
    const currentCanonical = out[canonical];
    if (
      currentCanonical === undefined ||
      currentCanonical === null ||
      currentCanonical === ""
    ) {
      out[canonical] = legacyVal;
    }
  }

  // Compose ind_address_* sub-fields into a single readable `address` if both
  // canonical `address` and `address_structured` are absent.
  if (subject === "individual" && !out.address && !out.address_structured) {
    const parts = [
      src.ind_address_index,
      src.ind_address_region,
      src.ind_address_district,
      src.ind_address_city,
      src.ind_address_street,
      src.ind_address_house,
      src.ind_address_apartment,
    ].filter((v) => v && String(v).trim().length > 0);
    if (parts.length > 0) out.address = parts.join(", ");
  }

  return out;
}

/**
 * sanitizeForWrite — write-side normalizer.
 *
 * Builds a clean object with ONLY canonical keys + GRP keys + any extra
 * unknown keys present on the original record (preserved verbatim so that
 * future rounds keep them).
 *
 * - Empty strings / undefined / null → dropped from canonical keys.
 * - Legacy `leg_*`/`ent_*`/`ind_*` keys mapped → canonical, then dropped.
 * - SERVICE_LEGACY_KEYS dropped entirely (purpose, status, validation_*, ...).
 * - GRP keys carried through if present in source.
 */
export function sanitizeForWrite(
  subject: SubjectKind,
  formValues: Record<string, unknown>,
  originalData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const canonicalKeys = new Set<string>(canonicalKeysForSubject(subject));
  const legacyMap = mapForSubject(subject);

  // 1) Canonical fields from form.
  for (const k of canonicalKeys) {
    const v = formValues[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }

  // 2) GRP fields — preserve from original (read-only in UI).
  if (originalData) {
    for (const k of GRP_KEYS) {
      const v = originalData[k];
      if (v !== undefined && v !== null && v !== "") out[k] = v;
    }
  }

  // 3) Preserve other unknown keys from original (forward-compat),
  //    excluding legacy keys we have already remapped and service keys.
  if (originalData) {
    for (const [k, v] of Object.entries(originalData)) {
      if (k in legacyMap) continue;
      if (canonicalKeys.has(k)) continue;
      if ((GRP_KEYS as readonly string[]).includes(k)) continue;
      if (SERVICE_LEGACY_KEYS.has(k)) continue;
      // ind_address_* sub-fields are intentionally collapsed into `address`
      // on read; don't re-emit them on write.
      if (subject === "individual" && /^ind_address_/.test(k)) continue;
      if (v === undefined || v === null || v === "") continue;
      out[k] = v;
    }
  }

  return out;
}

/**
 * pickGrpSummary — return GRP keys present on the record (read-only display).
 */
export function pickGrpSummary(
  data: Record<string, unknown> | null | undefined,
): Array<{ key: string; value: unknown }> {
  if (!data) return [];
  const out: Array<{ key: string; value: unknown }> = [];
  for (const k of GRP_KEYS) {
    const v = data[k];
    if (v !== undefined && v !== null && v !== "") out.push({ key: k, value: v });
  }
  return out;
}

export const GRP_LABELS: Record<(typeof GRP_KEYS)[number], string> = {
  grp_registration_date: "Дата регистрации",
  grp_tax_office_code: "Код ИМНС",
  grp_tax_office_name: "ИМНС",
  grp_status_code: "Код статуса",
  grp_status_name: "Статус",
  grp_short_name: "Краткое наименование",
  grp_liquidation_date: "Дата ликвидации",
  grp_liquidation_reason: "Причина ликвидации",
  grp_last_fetched_at: "Последнее обновление ЕГР",
};
