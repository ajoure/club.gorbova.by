// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4
// table-repeat-cell-render.ts — общий per-row cell renderer.
// ----------------------------------------------------------------------------
// Используется:
//   • E.3 dry-run preview (`resolve-package-tokens.ts` → resolveTableRepeatTokenCore)
//   • E.4 real DOCX expansion (`docx-table-repeat-expand.ts`)
// Parity DoD: оба слоя обязаны возвращать ОДИНАКОВЫЕ value для одинаковых
// входных данных (в пределах preview-cap 200 chars в dry-run).
//
// Чистый pure helper — без I/O, без supabase, без Deno globals.
// ============================================================================

import { formatPersonName, type PersonNameFormat } from './typed-tokens-resolver.ts';
import { inflectRu, type RuCase } from './ru-inflection.ts';
import {
  LN_SUB_FIELD_BY_KEY,
  LN_SUB_DATE_FORMATS,
  LN_SUB_NAME_FORMATS,
  extractLnSubFieldRaw,
  formatLnDate,
} from './ln-subfield-spec.ts';
import { isCaseModifier } from './case-format.ts';
import type { TableRepeatColumn } from './table-repeat-spec.ts';

export interface CellRenderResult {
  value: string;
  code?: string;
}

export function renderRolePersonCell(
  col: TableRepeatColumn,
  person: Record<string, unknown> | undefined,
): CellRenderResult {
  if (!person) return { value: '', code: 'no_person' };
  const subKey = col.source_key ?? 'full_name';
  const spec = LN_SUB_FIELD_BY_KEY.get(subKey);
  if (!spec) return { value: '', code: 'ln_subfield_unknown' };
  const raw = extractLnSubFieldRaw(person, spec);
  if (!raw) return { value: '', code: 'ln_subfield_value_empty' };
  let v = raw;
  if (spec.kind === 'name') {
    const fmt = col.format && LN_SUB_NAME_FORMATS.has(col.format) ? col.format : 'full';
    v = formatPersonName(raw, {
      format: fmt as PersonNameFormat,
      case: (col.case as RuCase | undefined) ?? null,
    });
  } else if (spec.kind === 'date') {
    const fmt = col.format && LN_SUB_DATE_FORMATS.has(col.format) ? col.format : 'dotted';
    v = formatLnDate(raw, fmt);
  } else if (
    (spec.kind === 'address_full' || spec.kind === 'address_part')
    && col.case && isCaseModifier(col.case)
  ) {
    const inf = inflectRu(v, col.case as RuCase);
    if (inf.applied) v = inf.value;
  }
  return { value: v };
}

export function readAssignmentCustomKey(
  assignment: { metadata: unknown },
  key: string,
  knownCustomKeysForRole?: ReadonlySet<string>,
): CellRenderResult {
  // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4: schema check
  if (knownCustomKeysForRole && !knownCustomKeysForRole.has(key)) {
    return { value: '', code: `role_no_custom_field_def:${key}` };
  }
  const meta = (assignment.metadata && typeof assignment.metadata === 'object')
    ? (assignment.metadata as Record<string, unknown>)
    : {};
  const custom = (meta['custom'] && typeof meta['custom'] === 'object')
    ? (meta['custom'] as Record<string, unknown>)
    : {};
  const raw = custom[key];
  if (raw == null || raw === '') return { value: '', code: 'ln_custom_value_empty' };
  return { value: String(raw) };
}

export function readAssignmentMetadataPath(
  assignment: { metadata: unknown },
  key: string,
): CellRenderResult {
  const meta = (assignment.metadata && typeof assignment.metadata === 'object')
    ? (assignment.metadata as Record<string, unknown>)
    : {};
  if (key === 'custom' || key.startsWith('custom.')) {
    return { value: '', code: 'tr_metadata_custom_not_allowed_via_metadata_source' };
  }
  let cur: unknown = meta;
  for (const seg of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return { value: '', code: 'tr_metadata_path_missing' };
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur == null || cur === '') return { value: '', code: 'tr_metadata_value_empty' };
  if (typeof cur === 'object') return { value: JSON.stringify(cur), code: undefined };
  return { value: String(cur) };
}

export interface RowRenderContext {
  rowIndex: number;
  assignment: { person_id: string | null; metadata: unknown };
  person?: Record<string, unknown>;
  pfCache: Map<string, { value: string; code?: string }>;
  knownCustomKeysForRole?: ReadonlySet<string>;
  isSuperAdmin?: boolean;
  /** Values from one row of a generic public-form repeat group, keyed by pf-id. */
  submissionValues?: Record<string, unknown>;
}

export function renderTableRepeatCell(
  col: TableRepeatColumn,
  ctx: RowRenderContext,
): CellRenderResult {
  switch (col.source_type) {
    case 'role_person':
      return renderRolePersonCell(col, ctx.person);
    case 'assignment_custom_field': {
      if (!col.source_key) return { value: '', code: 'missing_source_key' };
      return readAssignmentCustomKey(ctx.assignment, col.source_key, ctx.knownCustomKeysForRole);
    }
    case 'package_field': {
      if (!col.source_key) return { value: '', code: 'missing_source_key' };
      const cached = ctx.pfCache.get(col.source_key);
      if (!cached) return { value: '', code: 'pf_token_not_found' };
      return { value: cached.value, code: cached.code };
    }
    case 'static_text':
      return { value: col.source_key ?? '' };
    case 'row_number':
      return { value: String(ctx.rowIndex + 1) };
    case 'empty':
      return { value: '' };
    case 'assignment_metadata': {
      if (!ctx.isSuperAdmin) return { value: '', code: 'tr_metadata_source_super_admin_only' };
      if (!col.source_key) return { value: '', code: 'missing_source_key' };
      return readAssignmentMetadataPath(ctx.assignment, col.source_key);
    }
    case 'submission_field': {
      if (!col.source_key) return { value: '', code: 'missing_source_key' };
      const raw = ctx.submissionValues?.[col.source_key];
      if (raw == null || raw === '') return { value: '', code: 'submission_field_empty' };
      return { value: typeof raw === 'string' ? raw : String(raw) };
    }
    default:
      return { value: '', code: 'tr_column_resolve_failed' };
  }
}
