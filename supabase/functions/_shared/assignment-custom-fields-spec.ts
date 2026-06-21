/**
 * Assignment Custom Fields Spec — edge mirror.
 *
 * Mirror для: src/lib/documents/assignmentCustomFieldsSpec.ts
 * При изменениях обновлять оба файла одновременно.
 *
 * PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1 + E.1a.
 */

export type AssignmentCustomFieldType = "text" | "number" | "percent" | "date";
export type AssignmentCustomFieldKindV1 = "scalar_text";

export interface AssignmentCustomFieldDef {
  key: string;
  label: string;
  type: AssignmentCustomFieldType;
  kind?: AssignmentCustomFieldKindV1;
  placeholder?: string;
  required?: boolean;
}

export const RESERVED_CUSTOM_FIELD_KEYS = new Set<string>([
  "position",
  "position_gender",
  "custom",
  "person_id",
  "role_catalog_id",
  "assignment_id",
  "id",
  "sort_order",
  "is_active",
  "package_session_id",
  "package_template_item_id",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
]);

export const CUSTOM_FIELD_KEY_REGEX = /^[a-z][a-z0-9_]{0,49}$/;

export type CustomFieldKeyValidation =
  | { ok: true }
  | { ok: false; code: "invalid_format" | "reserved"; key: string };

export function validateCustomFieldKey(key: string): CustomFieldKeyValidation {
  if (!CUSTOM_FIELD_KEY_REGEX.test(key)) {
    return { ok: false, code: "invalid_format", key };
  }
  if (RESERVED_CUSTOM_FIELD_KEYS.has(key)) {
    return { ok: false, code: "reserved", key };
  }
  return { ok: true };
}

export function isValidCustomFieldKey(key: string): boolean {
  return validateCustomFieldKey(key).ok;
}

export function readAssignmentCustomFieldDefs(
  roleMetadata: unknown,
): AssignmentCustomFieldDef[] {
  if (!roleMetadata || typeof roleMetadata !== "object") return [];
  const raw = (roleMetadata as Record<string, unknown>).assignment_custom_fields;
  if (!Array.isArray(raw)) return [];
  const out: AssignmentCustomFieldDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const key = typeof obj.key === "string" ? obj.key : "";
    const label = typeof obj.label === "string" ? obj.label : "";
    const type = obj.type as AssignmentCustomFieldType | undefined;
    if (!key || !label) continue;
    if (!isValidCustomFieldKey(key)) continue;
    if (type !== "text" && type !== "number" && type !== "percent" && type !== "date") continue;
    const def: AssignmentCustomFieldDef = { key, label, type };
    if (obj.kind === "scalar_text") def.kind = "scalar_text";
    if (typeof obj.placeholder === "string") def.placeholder = obj.placeholder;
    if (typeof obj.required === "boolean") def.required = obj.required;
    out.push(def);
  }
  return out;
}

export function readAssignmentCustomValues(
  assignmentMetadata: unknown,
): Record<string, string> {
  if (!assignmentMetadata || typeof assignmentMetadata !== "object") return {};
  const customRaw = (assignmentMetadata as Record<string, unknown>).custom;
  if (!customRaw || typeof customRaw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(customRaw as Record<string, unknown>)) {
    if (!isValidCustomFieldKey(k)) continue;
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

export interface MergeCustomOptions {
  keepEmpty?: boolean;
}

export function mergeAssignmentMetadataWithCustom(
  existingMetadata: Record<string, unknown> | null | undefined,
  custom: Record<string, string> | undefined,
  options?: MergeCustomOptions,
): Record<string, unknown> {
  const keepEmpty = options?.keepEmpty === true;
  const base: Record<string, unknown> =
    existingMetadata && typeof existingMetadata === "object"
      ? { ...existingMetadata }
      : {};
  const cleanCustom: Record<string, string> = {};
  if (custom) {
    for (const [k, v] of Object.entries(custom)) {
      if (!isValidCustomFieldKey(k)) continue;
      if (v == null) continue;
      const str = typeof v === "string" ? v : String(v);
      if (str.length === 0 && !keepEmpty) continue;
      cleanCustom[k] = str;
    }
  }
  if (Object.keys(cleanCustom).length > 0) {
    base.custom = cleanCustom;
  } else {
    delete base.custom;
  }
  return base;
}
