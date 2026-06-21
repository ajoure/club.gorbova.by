/**
 * Assignment Custom Fields Spec — SOT для пользовательских доп. полей
 * назначения роли в пакете документов.
 *
 * Schema хранится в:
 *   document_package_role_catalog.metadata.assignment_custom_fields[]
 *
 * Values хранятся в:
 *   document_package_item_role_assignments.metadata.custom.<key>
 *
 * PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1.
 *
 * ВНИМАНИЕ: при изменениях этого файла обязательно синхронизировать
 * mirror на edge: supabase/functions/_shared/assignment-custom-fields-spec.ts
 */

export type AssignmentCustomFieldType = "text" | "number" | "percent" | "date";

/**
 * v1 «scalar_text»-alias (PATCH-E1a). Используется только в UI-редакторе схемы
 * для упрощённой формы (key/label). Для storage/резолва маппится в `type:'text'`.
 * Существующие типы text|number|percent|date НЕ удаляются — они уже могут
 * использоваться в `tableRepeatSpec` и более поздних этапах.
 */
export type AssignmentCustomFieldKindV1 = "scalar_text";

export interface AssignmentCustomFieldDef {
  key: string;
  label: string;
  type: AssignmentCustomFieldType;
  /** v1 UI hint; не нарушает контракт `type`. */
  kind?: AssignmentCustomFieldKindV1;
  placeholder?: string;
  required?: boolean;
}

/**
 * Ключи, запрещённые для custom field. Резервируют системные имена,
 * которые уже используются на верхнем уровне metadata назначения роли
 * или в стандартных мета-полях.
 */
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

/**
 * Безопасно читает массив определений custom fields из metadata роли.
 * Никогда не выбрасывает — возвращает [] при любых проблемах.
 */
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
    if (typeof obj.placeholder === "string") def.placeholder = obj.placeholder;
    if (typeof obj.required === "boolean") def.required = obj.required;
    out.push(def);
  }
  return out;
}

/**
 * Безопасно читает значения custom fields из metadata назначения.
 * Возвращает плоский объект { key: string-value }.
 */
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

/**
 * Merge новых custom values с существующим metadata назначения, СОХРАНЯЯ
 * системные ключи верхнего уровня (`position`, `position_gender` и т.п.).
 * Возвращает новый объект — input не мутируется.
 */
export function mergeAssignmentMetadataWithCustom(
  existingMetadata: Record<string, unknown> | null | undefined,
  custom: Record<string, string> | undefined,
): Record<string, unknown> {
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
      // Пустые значения не пишем (чтобы не плодить шум) — но и не падаем.
      if (str.length === 0) continue;
      cleanCustom[k] = str;
    }
  }
  if (Object.keys(cleanCustom).length > 0) {
    base.custom = cleanCustom;
  } else {
    // Удаляем пустой custom, чтобы не оставлять `{ custom: {} }` в БД.
    delete base.custom;
  }
  return base;
}
