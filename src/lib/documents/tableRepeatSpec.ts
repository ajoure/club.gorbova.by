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

/**
 * Stage E.2 — validateTableRepeatConfig (pure helper, без I/O).
 *
 * Возвращает массив структурированных проблем конфига:
 *   - `missing_role`         — role_catalog_id пустой;
 *   - `duplicate_cell_index` — два колонки с одинаковым cell_index;
 *   - `negative_cell_index`  — cell_index < 0;
 *   - `non_integer_cell_index` — cell_index дробный/NaN;
 *   - `missing_source_key`   — для role_person/assignment_custom_field/
 *                              package_field/static_text не задан source_key;
 *   - `orphan_custom_key`    — assignment_custom_field.source_key отсутствует
 *                              в текущей schema роли (warning, не блокирует save).
 *
 * Все коды-блокеры (severity='error') — основание не сохранять конфиг;
 * `orphan_custom_key` — единственный severity='warn'.
 */
export type TableRepeatIssueCode =
  | "missing_role"
  | "duplicate_cell_index"
  | "negative_cell_index"
  | "non_integer_cell_index"
  | "missing_source_key"
  | "orphan_custom_key";

export interface TableRepeatIssue {
  code: TableRepeatIssueCode;
  severity: "error" | "warn";
  cell_index?: number;
  source_key?: string;
  message: string;
}

export function validateTableRepeatConfig(
  cfg: TableRepeatConfig,
  ctx?: {
    knownCustomKeysForRole?: ReadonlySet<string>;
  },
): TableRepeatIssue[] {
  const issues: TableRepeatIssue[] = [];

  if (!cfg.role_catalog_id) {
    issues.push({
      code: "missing_role",
      severity: "error",
      message: "Не выбрана роль-источник для повторяемой строки.",
    });
  }

  const seenCells = new Map<number, number>();
  for (const col of cfg.columns) {
    if (!Number.isFinite(col.cell_index)) {
      issues.push({
        code: "non_integer_cell_index",
        severity: "error",
        cell_index: col.cell_index,
        message: "Номер колонки должен быть целым числом.",
      });
      continue;
    }
    if (!Number.isInteger(col.cell_index)) {
      issues.push({
        code: "non_integer_cell_index",
        severity: "error",
        cell_index: col.cell_index,
        message: "Номер колонки должен быть целым числом.",
      });
    }
    if (col.cell_index < 0) {
      issues.push({
        code: "negative_cell_index",
        severity: "error",
        cell_index: col.cell_index,
        message: "Номер колонки не может быть отрицательным.",
      });
    }
    seenCells.set(col.cell_index, (seenCells.get(col.cell_index) ?? 0) + 1);
  }
  for (const [idx, count] of seenCells.entries()) {
    if (count > 1) {
      issues.push({
        code: "duplicate_cell_index",
        severity: "error",
        cell_index: idx,
        message: `Колонка ${idx + 1} используется более одного раза.`,
      });
    }
  }

  for (const col of cfg.columns) {
    if (
      col.source_type === "role_person" ||
      col.source_type === "assignment_custom_field" ||
      col.source_type === "package_field" ||
      col.source_type === "static_text"
    ) {
      if (!col.source_key || col.source_key === "") {
        issues.push({
          code: "missing_source_key",
          severity: "error",
          cell_index: col.cell_index,
          message: `Колонка ${col.cell_index + 1}: не задан источник.`,
        });
      }
    }
    if (
      col.source_type === "assignment_custom_field" &&
      col.source_key &&
      ctx?.knownCustomKeysForRole &&
      !ctx.knownCustomKeysForRole.has(col.source_key)
    ) {
      issues.push({
        code: "orphan_custom_key",
        severity: "warn",
        cell_index: col.cell_index,
        source_key: col.source_key,
        message:
          `Колонка ${col.cell_index + 1}: доп. поле «${col.source_key}» ` +
          `больше не определено в schema роли. Конфиг сохранится как orphan-ref.`,
      });
    }
  }

  return issues;
}
