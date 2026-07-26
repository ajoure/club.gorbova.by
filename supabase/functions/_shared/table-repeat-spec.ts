/**
 * Table Repeat Spec — edge mirror.
 * Mirror для: src/lib/documents/tableRepeatSpec.ts
 *
 * PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1.
 */

export type TableRepeatColumnSourceType =
  | "role_person"
  | "assignment_custom_field"
  | "package_field"
  | "static_text"
  | "row_number"
  | "empty"
  | "assignment_metadata"
  | "submission_field";

export interface TableRepeatColumn {
  cell_index: number;
  source_type: TableRepeatColumnSourceType;
  source_key?: string;
  case?: string;
  format?: string;
}

export interface TableRepeatConfig {
  id: string;
  source_kind?: "role_assignments" | "external_submission";
  role_catalog_id?: string;
  repeat_group_key?: string;
  label?: string;
  columns: TableRepeatColumn[];
}

export const TABLE_REPEAT_MARKER_REGEX = /\{\{tableRepeat:(TR-\d{6,})\}\}/g;
export const TABLE_REPEAT_ID_REGEX = /^TR-\d{6,}$/;

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
    const source_kind = obj.source_kind === 'external_submission' ? 'external_submission' : 'role_assignments';
    const repeat_group_key = typeof obj.repeat_group_key === 'string' ? obj.repeat_group_key : '';
    if (!TABLE_REPEAT_ID_REGEX.test(id) || (source_kind === 'role_assignments' && !role_catalog_id) || (source_kind === 'external_submission' && !repeat_group_key)) continue;
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
        source_type !== "assignment_metadata" &&
        source_type !== "submission_field"
      ) {
        continue;
      }
      const col: TableRepeatColumn = { cell_index, source_type };
      if (typeof co.source_key === "string") col.source_key = co.source_key;
      if (typeof co.case === "string") col.case = co.case;
      if (typeof co.format === "string") col.format = co.format;
      columns.push(col);
    }
    const cfg: TableRepeatConfig = { id, source_kind, columns };
    if (role_catalog_id) cfg.role_catalog_id = role_catalog_id;
    if (repeat_group_key) cfg.repeat_group_key = repeat_group_key;
    if (typeof obj.label === "string") cfg.label = obj.label;
    out.push(cfg);
  }
  return out;
}

// Stage E.2 — validateTableRepeatConfig (edge mirror).
export type TableRepeatIssueCode =
  | "missing_role"
  | "invalid_source_for_external_submission"
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

  if ((cfg.source_kind ?? 'role_assignments') === 'role_assignments' && !cfg.role_catalog_id) {
    issues.push({
      code: "missing_role",
      severity: "error",
      message: "Не выбрана роль-источник для повторяемой строки.",
    });
  }
  if ((cfg.source_kind ?? 'role_assignments') === 'external_submission' && !cfg.repeat_group_key) {
    issues.push({ code: 'missing_role', severity: 'error', message: 'Не указана повторяемая группа внешней анкеты.' });
  }
  if ((cfg.source_kind ?? 'role_assignments') === 'external_submission') {
    for (const col of cfg.columns) {
      if (['role_person', 'assignment_custom_field', 'assignment_metadata'].includes(col.source_type)) {
        issues.push({ code: 'invalid_source_for_external_submission', severity: 'error', cell_index: col.cell_index,
          message: `Колонка ${col.cell_index + 1}: источник роли нельзя использовать в строке внешней анкеты.` });
      }
    }
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
      col.source_type === "static_text" ||
      col.source_type === "submission_field"
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

// Stage E.3 — validateTableRepeatMarkersInTemplate (edge mirror).
export type TableRepeatMarkerIssueCode =
  | "unknown_tr_id"
  | "duplicate_tr_marker_in_template"
  | "tr_config_has_errors";

export interface TableRepeatMarkerIssue {
  code: TableRepeatMarkerIssueCode;
  severity: "error" | "warn";
  tr_id: string;
  occurrences?: number;
  cfg_errors?: TableRepeatIssue[];
  message: string;
}

export function validateTableRepeatMarkersInTemplate(
  templateText: string,
  configs: TableRepeatConfig[],
  ctx?: {
    knownCustomKeysByRoleId?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): TableRepeatMarkerIssue[] {
  const issues: TableRepeatMarkerIssue[] = [];
  if (!templateText) return issues;

  const occByTr = new Map<string, number>();
  TABLE_REPEAT_MARKER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_REPEAT_MARKER_REGEX.exec(templateText)) !== null) {
    const trId = m[1];
    occByTr.set(trId, (occByTr.get(trId) ?? 0) + 1);
  }

  const cfgById = new Map<string, TableRepeatConfig>();
  for (const c of configs) cfgById.set(c.id, c);

  for (const [trId, count] of occByTr.entries()) {
    const cfg = cfgById.get(trId);
    if (!cfg) {
      issues.push({
        code: "unknown_tr_id",
        severity: "error",
        tr_id: trId,
        occurrences: count,
        message:
          `Маркер {{tableRepeat:${trId}}} есть в шаблоне, но конфиг с таким ` +
          `TR-id не найден в metadata.table_repeats этого документа.`,
      });
      continue;
    }
    if (count > 1) {
      issues.push({
        code: "duplicate_tr_marker_in_template",
        severity: "warn",
        tr_id: trId,
        occurrences: count,
        message:
          `Маркер {{tableRepeat:${trId}}} встречается в шаблоне ${count}× ` +
          `— в Stage E.4 каждое вхождение раскроется одинаково.`,
      });
    }
    const knownKeys = cfg.role_catalog_id ? ctx?.knownCustomKeysByRoleId?.get(cfg.role_catalog_id) : undefined;
    const cfgIssues = validateTableRepeatConfig(cfg, {
      knownCustomKeysForRole: knownKeys,
    });
    const errs = cfgIssues.filter((i) => i.severity === "error");
    if (errs.length > 0) {
      issues.push({
        code: "tr_config_has_errors",
        severity: "error",
        tr_id: trId,
        cfg_errors: errs,
        message:
          `Маркер {{tableRepeat:${trId}}} есть в шаблоне, но конфиг ` +
          `содержит ошибки (${errs.length}). Исправьте, иначе Stage E.4 не ` +
          `сможет развернуть строку.`,
      });
    }
  }

  return issues;
}
