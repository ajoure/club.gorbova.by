// ============================================================================
// Sprint 3I-A — edge mirror of the frontend package placeholder catalog SOT.
//
// Mirrors `src/utils/packagePlaceholderCatalog.ts`. Edge orchestrator MUST
// resolve `{{package.(ul|ip|fl).FLD-XXXXXX}}` only against this catalog and
// only when status === 'copy_ready'.
//
// Synced fields: groupId, reused_fld, source_table, source_path, status,
// tech_key, package_token. Address jsonb-path items keep their jsonb syntax
// in `source_path` (e.g. `client_legal_details.leg_address_structured->>'street'`).
// `deferred / pending_field` items are kept here so orchestrator can return
// `package_field_not_ready` with full traceability.
//
// SOT rule: any change to the frontend catalog MUST be mirrored here in the
// same patch. Do not add new FLD / new source_path here without a manifest
// proof (see plan §4).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
export type PackageGroupId = "package_ul" | "package_ip" | "package_fl" | "package_roles";

export type PackagePlaceholderStatus =
  | "source_available"
  | "copy_ready"
  | "pending_field"
  | "missing_source_column"
  | "deferred";

export interface PackagePlaceholderItem {
  groupId: PackageGroupId;
  source_table: "client_legal_details" | "legal_details_persons" | null;
  source_path: string | null;
  reused_fld: string | null;
  package_token: string | null;
  status: PackagePlaceholderStatus;
  tech_key: string;
}

function ready(
  group: PackageGroupId,
  reused_fld: string,
  source_table: "client_legal_details" | "legal_details_persons",
  column: string,
  tech_key: string,
): PackagePlaceholderItem {
  const prefix = group === "package_ul" ? "ul" : group === "package_ip" ? "ip" : "fl";
  return {
    groupId: group,
    source_table,
    source_path: `${source_table}.${column}`,
    reused_fld,
    package_token: `{{package.${prefix}.${reused_fld}}}`,
    status: "copy_ready",
    tech_key,
  };
}

function readyJson(
  group: PackageGroupId,
  reused_fld: string,
  source_table: "client_legal_details" | "legal_details_persons",
  jsonColumn: string,
  jsonKey: string,
  tech_key: string,
): PackagePlaceholderItem {
  const prefix = group === "package_ul" ? "ul" : group === "package_ip" ? "ip" : "fl";
  return {
    groupId: group,
    source_table,
    source_path: `${source_table}.${jsonColumn}->>'${jsonKey}'`,
    reused_fld,
    package_token: `{{package.${prefix}.${reused_fld}}}`,
    status: "copy_ready",
    tech_key,
  };
}

function deferred(
  group: PackageGroupId,
  status: "missing_source_column" | "pending_field" | "deferred",
  tech_key: string,
): PackagePlaceholderItem {
  return {
    groupId: group,
    source_table: null,
    source_path: null,
    reused_fld: null,
    package_token: null,
    status,
    tech_key,
  };
}

const PACKAGE_UL: PackagePlaceholderItem[] = [
  // Sprint 3L: short_name резолвится первым для FLD-000011 lookup
  // (`ЗАО «Ажур инкам»` вместо «голого» имени). `package.ul.name` остаётся
  // доступен как прямой tech_key, но findByPackageToken('package.ul.FLD-000011')
  // вернёт short_name.
  ready("package_ul", "FLD-000011", "client_legal_details", "leg_name", "package.ul.short_name"),
  ready("package_ul", "FLD-000011", "client_legal_details", "leg_name", "package.ul.name"),
  ready("package_ul", "FLD-000010", "client_legal_details", "leg_org_form", "package.ul.org_form"),
  ready("package_ul", "FLD-000009", "client_legal_details", "leg_unp", "package.ul.unp"),
  ready("package_ul", "FLD-000012", "client_legal_details", "leg_address", "package.ul.address_full"),
  ready("package_ul", "FLD-000014", "client_legal_details", "leg_director_name", "package.ul.director_full_name"),
  ready("package_ul", "FLD-000014", "client_legal_details", "leg_director_name", "package.ul.director_short_name"),
  ready("package_ul", "FLD-000013", "client_legal_details", "leg_director_position", "package.ul.director_position"),
  ready("package_ul", "FLD-000015", "client_legal_details", "leg_acts_on_basis", "package.ul.acts_on_basis"),
  ready("package_ul", "FLD-000005", "client_legal_details", "bank_name", "package.ul.bank_name"),
  ready("package_ul", "FLD-000006", "client_legal_details", "bank_code", "package.ul.bank_code"),
  ready("package_ul", "FLD-000004", "client_legal_details", "bank_account", "package.ul.bank_account"),
  ready("package_ul", "FLD-000007", "client_legal_details", "phone", "package.ul.phone"),
  ready("package_ul", "FLD-000008", "client_legal_details", "email", "package.ul.email"),
  readyJson("package_ul", "FLD-000035", "client_legal_details", "leg_address_structured", "street", "package.ul.address_street"),
  readyJson("package_ul", "FLD-000036", "client_legal_details", "leg_address_structured", "house", "package.ul.address_house"),
  readyJson("package_ul", "FLD-000037", "client_legal_details", "leg_address_structured", "building", "package.ul.address_building"),
  readyJson("package_ul", "FLD-000038", "client_legal_details", "leg_address_structured", "apartment", "package.ul.address_apartment"),
  readyJson("package_ul", "FLD-000039", "client_legal_details", "leg_address_structured", "city", "package.ul.address_city"),
  readyJson("package_ul", "FLD-000040", "client_legal_details", "leg_address_structured", "region", "package.ul.address_region"),
  readyJson("package_ul", "FLD-000041", "client_legal_details", "leg_address_structured", "postal_code", "package.ul.address_postal_code"),
  readyJson("package_ul", "FLD-000042", "client_legal_details", "leg_address_structured", "country", "package.ul.address_country"),
  deferred("package_ul", "pending_field", "package.ul.address_district"),
  deferred("package_ul", "pending_field", "package.ul.address_city_district"),
];

const PACKAGE_IP: PackagePlaceholderItem[] = [
  ready("package_ip", "FLD-000017", "client_legal_details", "ent_name", "package.ip.name"),
  ready("package_ip", "FLD-000017", "client_legal_details", "ent_name", "package.ip.short_name"),
  ready("package_ip", "FLD-000016", "client_legal_details", "ent_unp", "package.ip.unp"),
  ready("package_ip", "FLD-000018", "client_legal_details", "ent_address", "package.ip.address_full"),
  ready("package_ip", "FLD-000019", "client_legal_details", "ent_acts_on_basis", "package.ip.acts_on_basis"),
  ready("package_ip", "FLD-000005", "client_legal_details", "bank_name", "package.ip.bank_name"),
  ready("package_ip", "FLD-000006", "client_legal_details", "bank_code", "package.ip.bank_code"),
  ready("package_ip", "FLD-000004", "client_legal_details", "bank_account", "package.ip.bank_account"),
  ready("package_ip", "FLD-000007", "client_legal_details", "phone", "package.ip.phone"),
  ready("package_ip", "FLD-000008", "client_legal_details", "email", "package.ip.email"),
  readyJson("package_ip", "FLD-000043", "client_legal_details", "ent_address_structured", "street", "package.ip.address_street"),
  readyJson("package_ip", "FLD-000044", "client_legal_details", "ent_address_structured", "house", "package.ip.address_house"),
  readyJson("package_ip", "FLD-000045", "client_legal_details", "ent_address_structured", "building", "package.ip.address_building"),
  readyJson("package_ip", "FLD-000046", "client_legal_details", "ent_address_structured", "apartment", "package.ip.address_apartment"),
  readyJson("package_ip", "FLD-000047", "client_legal_details", "ent_address_structured", "city", "package.ip.address_city"),
  readyJson("package_ip", "FLD-000048", "client_legal_details", "ent_address_structured", "region", "package.ip.address_region"),
  readyJson("package_ip", "FLD-000049", "client_legal_details", "ent_address_structured", "postal_code", "package.ip.address_postal_code"),
  readyJson("package_ip", "FLD-000050", "client_legal_details", "ent_address_structured", "country", "package.ip.address_country"),
  deferred("package_ip", "pending_field", "package.ip.address_district"),
  deferred("package_ip", "pending_field", "package.ip.address_city_district"),
  deferred("package_ip", "deferred", "package.ip.director_full_name"),
  deferred("package_ip", "deferred", "package.ip.director_short_name"),
  deferred("package_ip", "deferred", "package.ip.director_position"),
  deferred("package_ip", "deferred", "package.ip.director_acts_on_basis"),
];

const PACKAGE_FL: PackagePlaceholderItem[] = [
  ready("package_fl", "FLD-000372", "legal_details_persons", "full_name", "package.fl.full_name"),
  ready("package_fl", "FLD-000372", "legal_details_persons", "full_name", "package.fl.full_name_short"),
  ready("package_fl", "FLD-000021", "legal_details_persons", "birth_date", "package.fl.birth_date"),
  ready("package_fl", "FLD-000027", "legal_details_persons", "personal_number", "package.fl.personal_number"),
  ready("package_fl", "FLD-000022", "legal_details_persons", "passport_series", "package.fl.passport_series"),
  ready("package_fl", "FLD-000023", "legal_details_persons", "passport_number", "package.fl.passport_number"),
  ready("package_fl", "FLD-000023", "legal_details_persons", "passport_number_full", "package.fl.passport_number_full"),
  ready("package_fl", "FLD-000024", "legal_details_persons", "passport_issued_by", "package.fl.passport_issued_by"),
  ready("package_fl", "FLD-000025", "legal_details_persons", "passport_issued_date", "package.fl.passport_issued_date"),
  ready("package_fl", "FLD-000026", "legal_details_persons", "passport_valid_until", "package.fl.passport_valid_until"),
  ready("package_fl", "FLD-000007", "legal_details_persons", "phone", "package.fl.phone"),
  ready("package_fl", "FLD-000008", "legal_details_persons", "email", "package.fl.email"),
  readyJson("package_fl", "FLD-000032", "legal_details_persons", "address_structured", "street", "package.fl.address_street"),
  readyJson("package_fl", "FLD-000033", "legal_details_persons", "address_structured", "house", "package.fl.address_house"),
  readyJson("package_fl", "FLD-000034", "legal_details_persons", "address_structured", "apartment", "package.fl.address_apartment"),
  readyJson("package_fl", "FLD-000031", "legal_details_persons", "address_structured", "city", "package.fl.address_city"),
  readyJson("package_fl", "FLD-000029", "legal_details_persons", "address_structured", "region", "package.fl.address_region"),
  readyJson("package_fl", "FLD-000030", "legal_details_persons", "address_structured", "district", "package.fl.address_district"),
  readyJson("package_fl", "FLD-000028", "legal_details_persons", "address_structured", "postal_code", "package.fl.address_postal_code"),
  deferred("package_fl", "pending_field", "package.fl.address_full"),
  deferred("package_fl", "pending_field", "package.fl.address_building"),
  deferred("package_fl", "pending_field", "package.fl.address_city_district"),
  deferred("package_fl", "pending_field", "package.fl.address_country"),
  ready("package_fl", "FLD-000004", "legal_details_persons", "bank_account", "package.fl.bank_account"),
  ready("package_fl", "FLD-000005", "legal_details_persons", "bank_name", "package.fl.bank_name"),
  ready("package_fl", "FLD-000006", "legal_details_persons", "bank_code", "package.fl.bank_code"),
];

export const PACKAGE_PLACEHOLDER_CATALOG: PackagePlaceholderItem[] = [
  ...PACKAGE_UL,
  ...PACKAGE_IP,
  ...PACKAGE_FL,
];

/**
 * Lookup a package-FLD token like `package.ul.FLD-000011` (without `{{...}}`).
 * Multiple catalog entries may map to the same `reused_fld` for one group —
 * they are equivalent (same source path), so the first match wins.
 */
export function findByPackageToken(
  innerToken: string,
): PackagePlaceholderItem | null {
  // innerToken: "package.ul.FLD-000011"
  const m = innerToken.match(/^package\.(ul|ip|fl)\.(FLD-\d{6})$/);
  if (!m) return null;
  const groupId: PackageGroupId =
    m[1] === "ul" ? "package_ul" : m[1] === "ip" ? "package_ip" : "package_fl";
  const fld = m[2];
  for (const item of PACKAGE_PLACEHOLDER_CATALOG) {
    if (item.groupId === groupId && item.reused_fld === fld) return item;
  }
  return null;
}

/**
 * Read a value from a JSON-path source_path encoded as
 *   "table.column->>'key'" — returns the string at jsonb[key], or '' if absent.
 */
export function readSourcePath(
  row: Record<string, any> | null | undefined,
  source_path: string,
): string {
  if (!row) return "";
  // jsonb form: table.column->>'key'
  const jsonMatch = source_path.match(/^[a-z_]+\.([a-z_]+)->>'([a-z_]+)'$/i);
  if (jsonMatch) {
    const col = jsonMatch[1];
    const key = jsonMatch[2];
    const blob = row[col];
    if (!blob || typeof blob !== "object") return "";
    const v = (blob as any)[key];
    return v == null ? "" : String(v);
  }
  // Flat form: table.column
  const flatMatch = source_path.match(/^[a-z_]+\.([a-z_]+)$/i);
  if (flatMatch) {
    const v = row[flatMatch[1]];
    return v == null ? "" : String(v);
  }
  return "";
}
