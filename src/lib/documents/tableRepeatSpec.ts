/**
 * Table Repeat Spec — SOT для повторяемых строк таблицы DOCX по роли.
 *
 * Хранится в:
 *   document_package_template_items.metadata.table_repeats[]
 *
 * Маркер в DOCX (первая ячейка шаблонной строки):
 *   {{tableRepeat:TR-XXXXXX}}
 *
 * PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1.
 *
 * ВНИМАНИЕ: mirror на edge — supabase/functions/_shared/table-repeat-spec.ts
 */

export type TableRepeatColumnSourceType =
  | "role_person"               // sub-field физлица (из 25)
  | "assignment_custom_field"   // доп. поле роли (key из role.assignment_custom_fields)
  | "package_field"             // pf-XXXXXX (поле пакета, одинаковое для всех строк)
  | "static_text"               // литерал
  | "row_number"                // 1, 2, 3…
  | "empty"                     // пустая ячейка
  | "assignment_metadata";      // (advanced fallback) произвольный ключ metadata.custom

export interface TableRepeatColumn {
  cell_index: number;                       // 0-based индекс ячейки в строке
  source_type: TableRepeatColumnSourceType;
  source_key?: string;                      // sub_field key / custom key / pf-id
  case?: string;                            // for ln subfields: nominative/genitive/...
  format?: string;                          // for sub-fields: short/full/long
}

export interface TableRepeatConfig {
  id: string;                               // TR-XXXXXX
  role_catalog_id: string;                  // роль, по которой размножается строка
  label?: string;                           // человекочитаемое имя (UI only)
  columns: TableRepeatColumn[];
}

export const TABLE_REPEAT_MARKER_REGEX = /\{\{tableRepeat:(TR-\d{6,})\}\}/g;
export const TABLE_REPEAT_ID_REGEX = /^TR-\d{6,}$/;

/**
 * Генератор следующего TR-id. Идёт по существующим id вида TR-NNNNNN,
 * берёт max+1, минимум TR-000001.
 */
export function nextTableRepeatId(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const m = /^TR-(\d{6,})$/.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return `TR-${String(next).padStart(6, "0")}`;
}

export function readTableRepeats(
  itemMetadata: unknown,
): TableRepeatConfig[] {
  if (!itemMetadata || typeof itemMetadata !== "object") return [];
  const raw = (itemMetadata as Record<string, unknown>).table_repeats;
  if (!Array.isArray(raw)) return [];
  const out: TableRepeatConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    const role_catalog_id =
      typeof obj.role_catalog_id === "string" ? obj.role_catalog_id : "";
    if (!TABLE_REPEAT_ID_REGEX.test(id) || !role_catalog_id) continue;
    const columnsRaw = Array.isArray(obj.columns) ? obj.columns : [];
    const columns: TableRepeatColumn[] = [];
    for (const c of columnsRaw) {
      if (!c || typeof c !== "object") continue;
      const co = c as Record<string, unknown>;
      const cell_index = typeof co.cell_index === "number" ? co.cell_index : NaN;
      const source_type = co.source_type as TableRepeatColumnSourceType;
      if (!Number.isFinite(cell_index)) continue;
      if (
        source_type !== "role_person" &&
        source_type !== "assignment_custom_field" &&
        source_type !== "package_field" &&
        source_type !== "static_text" &&
        source_type !== "row_number" &&
        source_type !== "empty" &&
        source_type !== "assignment_metadata"
      ) {
        continue;
      }
      const col: TableRepeatColumn = { cell_index, source_type };
      if (typeof co.source_key === "string") col.source_key = co.source_key;
      if (typeof co.case === "string") col.case = co.case;
      if (typeof co.format === "string") col.format = co.format;
      columns.push(col);
    }
    const cfg: TableRepeatConfig = { id, role_catalog_id, columns };
    if (typeof obj.label === "string") cfg.label = obj.label;
    out.push(cfg);
  }
  return out;
}
