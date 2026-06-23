// ============================================================================
// resolve-package-tokens.ts — Sprint 3C
// ----------------------------------------------------------------------------
// Резолвер пакетных alias-токенов (`package.roles.<role_key>.<field>`).
//
// СТАТУС:
//   • Публичная функция `resolvePackageToken` — guarded by HARDCODED_ENABLED=false.
//     Production-код её НЕ импортирует, canonical-document-generate-strict
//     НЕ изменён. Routing-точка переносится в Sprint 3D.
//   • `resolvePackageTokenCore` — pure-logic функция, доступная только для:
//        - изолированной dry-run edge-функции `package-tokens-dry-run`
//          (super_admin only, не пишет в snapshot/storage/generation);
//        - Deno-тестов.
//     Импорт `resolvePackageTokenCore` в production-пайплайн ЗАПРЕЩЁН.
//
// Контракты:
//   - SOT alias'ов:        public.document_package_token_aliases
//   - SOT персон:          public.legal_details_persons (по person_id)
//   - SOT участников роли: public.document_package_session_participants
//   - Field-ID first:      canonical_field_public_id → fields_registry.public_id
//   - Source-path канонически:
//       package_person     → читает person.full_name
//       package_metadata   → читает participant.metadata.<source_path tail>
//                            source_path для position ОБЯЗАН быть 'metadata.position'.
//
// Default-deny: любой неразрешённый случай возвращает { resolved:false, ... }.
// Запрещено: fallback на legal_details_entity_person_links, чтение legacy
// document_token_aliases, вызов billing/customer/executor резолверов.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { isCaseModifier, type CaseContext } from './case-format.ts';
import { formatPersonName, type PersonNameFormat } from './typed-tokens-resolver.ts';
import { inflectRu, type RuCase } from './ru-inflection.ts';
import {
  LN_SUB_FIELD_BY_KEY,
  LN_SUB_DATE_FORMATS,
  LN_SUB_NAME_FORMATS,
  extractLnSubFieldRaw,
  formatLnDate,
} from './ln-subfield-spec.ts';
import {
  readTableRepeats,
  validateTableRepeatConfig,
  type TableRepeatColumn,
  type TableRepeatConfig,
  type TableRepeatIssue,
} from './table-repeat-spec.ts';



/** Жёсткий выключатель: production-вызов всегда возвращает FEATURE_DISABLED. */
export const HARDCODED_ENABLED = false;

const PERSON_NAME_FORMATS: ReadonlySet<PersonNameFormat> = new Set(['full', 'short', 'signature_short']);

export interface PackageTokenResolveInput {
  rawToken: string;
  packageSessionId: string;
  /**
   * Sprint 3G: per-document scope. Когда указан — резолвер читает
   * `document_package_item_role_assignments` (document-level SOT),
   * а не legacy `document_package_session_participants`.
   */
  packageTemplateItemId?: string | null;
  supabase: SupabaseClient;
  caseContext?: Omit<CaseContext, 'tokenKey'>;
}


export type PackageTokenResolveCode =
  | 'feature_off'
  | 'alias_missing'
  | 'participant_missing'
  | 'multiple_role_assignments'
  | 'no_person'
  | 'person_missing'
  | 'empty_value'
  | 'config_error'
  // Sprint 3H-fix: ln-XXXXXX branch
  | 'ln_token_not_found'
  | 'ln_token_outside_bound_package'
  | 'role_assignment_missing'
  // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1
  | 'ln_subfield_unknown'
  | 'ln_case_not_supported_for_subfield'
  | 'multiple_persons_for_scalar_role_subfield'
  | 'ln_subfield_value_empty'
  // PATCH-PACKAGE-CUSTOM-FIELDS-V1: pf-XXXXXX branch
  | 'pf_token_not_found'
  | 'pf_token_outside_bound_package'
  | 'pf_value_missing'
  | 'pf_required_value_missing'
  | 'pf_invalid_choice'
  | 'pf_value_type_mismatch'
  | 'pf_unsupported_modifier'
  // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a: ln-XXXXXX.custom.<key> branch
  | 'role_no_custom_field_def'
  | 'multiple_persons_for_scalar_role_custom_field'
  | 'ln_custom_value_empty';

export type PackageTokenResolveResult =
  | {
      resolved: true;
      value: string;
      aliasId: string;
      canonicalFieldPublicId: string;
      roleKey: string;
      contextKind: string;
    }
  | {
      resolved: false;
      code: PackageTokenResolveCode;
      warning: string;
      aliasId?: string;
      roleKey?: string;
    };

const FEATURE_DISABLED = (): PackageTokenResolveResult => ({
  resolved: false,
  code: 'feature_off',
  warning: 'package_resolver_disabled',
});

function parseRawToken(raw: string): {
  aliasToken: string;
  caseMod?: string;
  formatMod?: string;
  duplicateModifier?: string;
} {
  const parts = raw.split('|').map((s) => s.trim());
  const aliasToken = parts[0];
  let caseMod: string | undefined;
  let formatMod: string | undefined;
  const seen = new Set<string>();
  for (const seg of parts.slice(1)) {
    if (!seg) continue;
    const [k, v] = seg.split('=').map((s) => s?.trim());
    if (!k || !v) continue;
    if (seen.has(k)) return { aliasToken, duplicateModifier: k };
    seen.add(k);
    if (k === 'case') caseMod = v;
    else if (k === 'format') formatMod = v;
  }
  return { aliasToken, caseMod, formatMod };
}

function readJsonPath(root: unknown, path: string): unknown {
  if (root == null || !path) return undefined;
  // deno-lint-ignore no-explicit-any
  let cur: any = root;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Sprint 3H-fix: резолв канонического {{ln-XXXXXX}} (document-level role token).
 *
 * Контракт:
 *   • Требуется packageTemplateItemId — без него нельзя выбрать assignment.
 *   • Роль ищем в `document_package_role_catalog.public_id` (ln-XXXXXX).
 *   • Принадлежность пакету: role.package_template_id === item.package_template_id.
 *   • Active assignments: `document_package_item_role_assignments`
 *     (package_session_id, package_template_item_id, role_catalog_id, is_active=true).
 *   • 0 → `role_assignment_missing` (warning по контракту валидатора/UI).
 *   • >1 → `multiple_role_assignments` (Sprint 3H semantics: пока берём первого).
 *   • 1 → output_template: "{{position}}, {{full_name}}" по умолчанию.
 */
async function resolveLnRoleToken(
  input: PackageTokenResolveInput,
  lnPublicId: string,
  caseMod: string | undefined,
  formatMod: string | undefined,
): Promise<PackageTokenResolveResult> {
  if (!input.packageTemplateItemId) {
    return {
      resolved: false,
      code: 'config_error',
      warning: 'ln_token_requires_package_template_item_id',
    };
  }

  // Validate modifiers (defence-in-depth; strict-parser также проверяет).
  if (formatMod && !PERSON_NAME_FORMATS.has(formatMod as PersonNameFormat)) {
    return {
      resolved: false,
      code: 'config_error',
      warning: `ln_unknown_format_modifier:${formatMod}`,
    };
  }
  if (caseMod && !isCaseModifier(caseMod)) {
    return {
      resolved: false,
      code: 'config_error',
      warning: `ln_unknown_case_modifier:${caseMod}`,
    };
  }

  // 1. ln-XXXXXX → role catalog row
  const { data: roleRow, error: roleErr } = await input.supabase
    .from('document_package_role_catalog')
    .select('id, package_template_id, role_key, output_template, is_active')
    .eq('public_id', lnPublicId)
    .maybeSingle();
  if (roleErr || !roleRow) {
    return {
      resolved: false,
      code: 'ln_token_not_found',
      warning: `ln_token_not_found:${lnPublicId}`,
    };
  }
  const role = roleRow as {
    id: string;
    package_template_id: string;
    role_key: string;
    output_template: string | null;
    is_active: boolean;
  };

  // 2. item → package_template_id (проверка принадлежности)
  const { data: itemRow, error: itemErr } = await input.supabase
    .from('document_package_template_items')
    .select('package_template_id')
    .eq('id', input.packageTemplateItemId)
    .maybeSingle();
  if (itemErr || !itemRow) {
    return {
      resolved: false,
      code: 'config_error',
      warning: `package_template_item_not_found:${input.packageTemplateItemId}`,
      roleKey: role.role_key,
    };
  }
  if ((itemRow as { package_template_id: string }).package_template_id !== role.package_template_id) {
    return {
      resolved: false,
      code: 'ln_token_outside_bound_package',
      warning: `ln_token_outside_bound_package:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  // 3. Active assignments
  const { data: rows, error: asgErr } = await input.supabase
    .from('document_package_item_role_assignments')
    .select('person_id, metadata, sort_order, created_at')
    .eq('package_session_id', input.packageSessionId)
    .eq('package_template_item_id', input.packageTemplateItemId)
    .eq('role_catalog_id', role.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (asgErr) {
    return {
      resolved: false,
      code: 'role_assignment_missing',
      warning: `role_assignment_query_error:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }
  const assignments = (rows ?? []) as Array<{ person_id: string | null }>;
  if (assignments.length === 0) {
    return {
      resolved: false,
      code: 'role_assignment_missing',
      warning: `role_assignment_missing:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  // Sprint 3J-Roles: multi-assignment → формируем всех активных, join `; `.
  const personIds = assignments.map((a) => a.person_id).filter((x): x is string => !!x);
  if (personIds.length === 0) {
    return {
      resolved: false,
      code: 'no_person',
      warning: `person_id_null:${role.role_key}`,
      roleKey: role.role_key,
    };
  }
  const { data: persons, error: personErr } = await input.supabase
    .from('legal_details_persons')
    .select('id, full_name')
    .in('id', personIds);
  if (personErr || !persons || persons.length === 0) {
    return {
      resolved: false,
      code: 'person_missing',
      warning: 'person_not_found',
      roleKey: role.role_key,
    };
  }
  const personById = new Map<string, string>(
    (persons as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, (p.full_name ?? '').trim()]),
  );

  const fmt = (formatMod ?? 'full') as PersonNameFormat;
  const cs = (caseMod ?? null) as RuCase | null;
  const renderedParts = personIds
    .map((pid) => personById.get(pid) ?? '')
    .filter((n) => n.length > 0)
    .map((name) => formatPersonName(name, { format: fmt, case: cs }));

  const value = renderedParts.join('; ');
  if (!value) {
    return {
      resolved: false,
      code: 'empty_value',
      warning: `value_empty:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  return {
    resolved: true,
    value,
    aliasId: role.id,
    canonicalFieldPublicId: lnPublicId,
    roleKey: role.role_key,
    contextKind: 'package_role_ln',
  };
}

/**
 * PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1
 * Резолв {{ln-XXXXXX.<sub_field>[|case=...][|format=...]}} для dry-run.
 */
async function resolveLnSubFieldToken(
  input: PackageTokenResolveInput,
  lnPublicId: string,
  subField: string,
  caseMod: string | undefined,
  formatMod: string | undefined,
): Promise<PackageTokenResolveResult> {
  if (!input.packageTemplateItemId) {
    return { resolved: false, code: 'config_error', warning: 'ln_token_requires_package_template_item_id' };
  }
  const spec = LN_SUB_FIELD_BY_KEY.get(subField);
  if (!spec) {
    return { resolved: false, code: 'ln_subfield_unknown', warning: `ln_subfield_unknown:${lnPublicId}.${subField}` };
  }
  if (caseMod && !spec.supports_case) {
    return {
      resolved: false,
      code: 'ln_case_not_supported_for_subfield',
      warning: `ln_case_not_supported_for_subfield:${lnPublicId}.${subField}`,
    };
  }
  if (formatMod) {
    if (spec.kind === 'date' && !LN_SUB_DATE_FORMATS.has(formatMod)) {
      return { resolved: false, code: 'config_error', warning: `ln_subfield_unknown_format:${formatMod}` };
    }
    if (spec.kind === 'name' && !LN_SUB_NAME_FORMATS.has(formatMod)) {
      return { resolved: false, code: 'config_error', warning: `ln_subfield_unknown_format:${formatMod}` };
    }
  }
  if (caseMod && !isCaseModifier(caseMod)) {
    return { resolved: false, code: 'config_error', warning: `ln_unknown_case_modifier:${caseMod}` };
  }

  // 1. role catalog row
  const { data: roleRow } = await input.supabase
    .from('document_package_role_catalog')
    .select('id, package_template_id, role_key')
    .eq('public_id', lnPublicId)
    .maybeSingle();
  if (!roleRow) {
    return { resolved: false, code: 'ln_token_not_found', warning: `ln_token_not_found:${lnPublicId}` };
  }
  const role = roleRow as { id: string; package_template_id: string; role_key: string };

  // 2. item ↔ template binding check
  const { data: itemRow } = await input.supabase
    .from('document_package_template_items')
    .select('package_template_id')
    .eq('id', input.packageTemplateItemId)
    .maybeSingle();
  if (!itemRow || (itemRow as { package_template_id: string }).package_template_id !== role.package_template_id) {
    return {
      resolved: false,
      code: 'ln_token_outside_bound_package',
      warning: `ln_token_outside_bound_package:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  // 3. assignments → person_ids
  const { data: asgs } = await input.supabase
    .from('document_package_item_role_assignments')
    .select('person_id, sort_order, created_at')
    .eq('package_session_id', input.packageSessionId)
    .eq('package_template_item_id', input.packageTemplateItemId)
    .eq('role_catalog_id', role.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const personIds = ((asgs ?? []) as Array<{ person_id: string | null }>)
    .map((a) => a.person_id).filter((x): x is string => !!x);
  if (personIds.length === 0) {
    return { resolved: false, code: 'role_assignment_missing', warning: `role_assignment_missing:${lnPublicId}.${subField}`, roleKey: role.role_key };
  }

  // 4. persons with all columns
  const { data: persons } = await input.supabase
    .from('legal_details_persons')
    .select('*')
    .in('id', personIds);
  const personById = new Map<string, Record<string, unknown>>(
    ((persons ?? []) as Array<Record<string, unknown>>).map((p) => [(p as any).id, p]),
  );

  const rawValues = personIds
    .map((pid) => personById.get(pid))
    .filter((p): p is Record<string, unknown> => !!p)
    .map((p) => extractLnSubFieldRaw(p, spec))
    .filter((v) => v.length > 0);

  if (rawValues.length === 0) {
    return {
      resolved: false,
      code: 'ln_subfield_value_empty',
      warning: `ln_subfield_value_empty:${lnPublicId}.${subField}`,
      roleKey: role.role_key,
    };
  }

  // multi-policy
  if (rawValues.length > 1 && spec.multi_policy === 'error') {
    return {
      resolved: false,
      code: 'multiple_persons_for_scalar_role_subfield',
      warning: `multiple_persons_for_scalar_role_subfield:${lnPublicId}.${subField}:n=${rawValues.length}`,
      roleKey: role.role_key,
    };
  }

  const cs = (caseMod ?? null) as RuCase | null;
  const fmt = formatMod ?? null;
  const renderedParts: string[] = [];
  for (const raw of rawValues) {
    let v = raw;
    if (spec.kind === 'name') {
      v = formatPersonName(raw, { format: (fmt ?? 'full') as PersonNameFormat, case: cs });
    } else if (spec.kind === 'date') {
      v = formatLnDate(raw, fmt ?? 'dotted');
    } else if ((spec.kind === 'address_full' || spec.kind === 'address_part') && cs) {
      const inf = inflectRu(v, cs);
      if (inf.applied) v = inf.value;
    }
    if (v) renderedParts.push(v);
  }
  const value = renderedParts.join('; ');
  if (!value) {
    return {
      resolved: false,
      code: 'ln_subfield_value_empty',
      warning: `ln_subfield_value_empty:${lnPublicId}.${subField}`,
      roleKey: role.role_key,
    };
  }
  return {
    resolved: true,
    value,
    aliasId: role.id,
    canonicalFieldPublicId: `${lnPublicId}.${subField}`,
    roleKey: role.role_key,
    contextKind: 'package_role_ln_sub',
  };
}

// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a
// ----------------------------------------------------------------------------
// {{ln-XXXXXX.custom.<key>}} — scalar custom assignment field.
//
// Контракт (dry-run only; реальная DOCX-подстановка в Stage E.4):
//   • Schema SOT:    document_package_role_catalog.metadata.assignment_custom_fields[]
//   • Values SOT:    document_package_item_role_assignments.metadata.custom.<key>
//   • Strict scope:  package_session_id + package_template_item_id + role_catalog_id
//                    + is_active=true + person_id IS NOT NULL.
//   • Состояния:
//       ok                                            — 1 assignment + ключ в schema + значение.
//       ln_token_not_found                            — public_id не найден в catalog.
//       ln_token_outside_bound_package                — роль из другого пакета.
//       role_no_custom_field_def                      — ключ не объявлен в schema роли.
//       role_assignment_missing                       — 0 active assignments (тот же код,
//                                                       что у sub-field резолвера).
//       multiple_persons_for_scalar_role_custom_field — >1 active assignments
//                                                       (controlled warning, не error).
//       ln_custom_value_empty                         — значение отсутствует / пустая строка.
// ============================================================================

async function resolveLnCustomToken(
  input: PackageTokenResolveInput,
  lnPublicId: string,
  customKey: string,
): Promise<PackageTokenResolveResult> {
  if (!input.packageTemplateItemId) {
    return { resolved: false, code: 'config_error', warning: 'ln_token_requires_package_template_item_id' };
  }

  // 1. role catalog row + schema
  const { data: roleRow } = await input.supabase
    .from('document_package_role_catalog')
    .select('id, package_template_id, role_key, metadata')
    .eq('public_id', lnPublicId)
    .maybeSingle();
  if (!roleRow) {
    return { resolved: false, code: 'ln_token_not_found', warning: `ln_token_not_found:${lnPublicId}` };
  }
  const role = roleRow as {
    id: string;
    package_template_id: string;
    role_key: string;
    metadata: Record<string, unknown> | null;
  };

  // 2. item ↔ template binding
  const { data: itemRow } = await input.supabase
    .from('document_package_template_items')
    .select('package_template_id')
    .eq('id', input.packageTemplateItemId)
    .maybeSingle();
  if (!itemRow || (itemRow as { package_template_id: string }).package_template_id !== role.package_template_id) {
    return {
      resolved: false,
      code: 'ln_token_outside_bound_package',
      warning: `ln_token_outside_bound_package:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  // 3. Schema check — есть ли ключ в assignment_custom_fields[]
  const defs = Array.isArray(role.metadata?.['assignment_custom_fields'])
    ? (role.metadata!['assignment_custom_fields'] as Array<Record<string, unknown>>)
    : [];
  const hasDef = defs.some((d) => typeof d?.key === 'string' && d.key === customKey);
  if (!hasDef) {
    return {
      resolved: false,
      code: 'role_no_custom_field_def',
      warning: `role_no_custom_field_def:${lnPublicId}.${customKey}`,
      roleKey: role.role_key,
    };
  }

  // 4. active assignments (scope: session + item + role)
  const { data: asgs } = await input.supabase
    .from('document_package_item_role_assignments')
    .select('person_id, metadata, sort_order, created_at')
    .eq('package_session_id', input.packageSessionId)
    .eq('package_template_item_id', input.packageTemplateItemId)
    .eq('role_catalog_id', role.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const rows = ((asgs ?? []) as Array<{ person_id: string | null; metadata: unknown }>)
    .filter((r) => r.person_id != null);
  if (rows.length === 0) {
    // Same code as sub-field resolver to keep UI behavior consistent.
    return {
      resolved: false,
      code: 'role_assignment_missing',
      warning: `role_assignment_missing:${lnPublicId}.custom.${customKey}`,
      roleKey: role.role_key,
    };
  }
  if (rows.length > 1) {
    return {
      resolved: false,
      code: 'multiple_persons_for_scalar_role_custom_field',
      warning: `multiple_persons_for_scalar_role_custom_field:${lnPublicId}.custom.${customKey}:n=${rows.length}`,
      roleKey: role.role_key,
    };
  }

  // 5. read value
  const meta = (rows[0].metadata && typeof rows[0].metadata === 'object')
    ? (rows[0].metadata as Record<string, unknown>)
    : {};
  const custom = (meta['custom'] && typeof meta['custom'] === 'object')
    ? (meta['custom'] as Record<string, unknown>)
    : {};
  const raw = custom[customKey];
  const value = raw == null ? '' : String(raw);
  if (value.length === 0) {
    return {
      resolved: false,
      code: 'ln_custom_value_empty',
      warning: `ln_custom_value_empty:${lnPublicId}.custom.${customKey}`,
      roleKey: role.role_key,
    };
  }

  return {
    resolved: true,
    value,
    aliasId: role.id,
    canonicalFieldPublicId: `${lnPublicId}.custom.${customKey}`,
    roleKey: role.role_key,
    contextKind: 'package_role_ln_custom',
  };
}

// ============================================================================
// PATCH-PACKAGE-CUSTOM-FIELDS-V1: pf-XXXXXX (per-package custom field) branch
// ----------------------------------------------------------------------------
// Контракт:
//   • Source-of-truth поля:       `document_package_field_catalog` (public_id = pf-XXXXXX)
//   • Source-of-truth значения:   `document_package_session_field_values`
//   • Резолвер живёт исключительно в namespace пакета сессии. Использование
//     `pf-XXXXXX` другого пакета → `pf_token_outside_bound_package`.
//   • Required (catalog.required OR assignment.is_required_override) и
//     отсутствующее значение → `pf_required_value_missing`.
//   • Никаких legacy alias-fallback.
// ============================================================================

const DATE_FULL_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: 'long', year: 'numeric',
});
const DATE_SHORT_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});

export function formatPfValue(
  dataType: string,
  rawValue: unknown,
  options: Record<string, unknown> | null | undefined,
  formatMod: string | undefined,
): { value: string } | { error: string } {
  if (rawValue == null || rawValue === '') return { value: '' };
  const opts = (options ?? {}) as Record<string, unknown>;

  switch (dataType) {
    case 'text': {
      return { value: String(rawValue) };
    }
    case 'number':
    case 'year': {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return { error: 'pf_value_type_mismatch' };
      return { value: String(n) };
    }
    case 'date': {
      const d = new Date(String(rawValue));
      if (isNaN(d.getTime())) return { error: 'pf_value_type_mismatch' };
      if (formatMod === 'short') return { value: DATE_SHORT_FMT.format(d) };
      if (formatMod === 'year_only') return { value: String(d.getFullYear()) };
      if (formatMod === 'month_year')
        return { value: `${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}` };
      return { value: DATE_FULL_FMT.format(d) };
    }
    case 'datetime': {
      const d = new Date(String(rawValue));
      if (isNaN(d.getTime())) return { error: 'pf_value_type_mismatch' };
      const datePart = formatMod === 'short' ? DATE_SHORT_FMT.format(d) : DATE_FULL_FMT.format(d);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { value: `${datePart} ${hh}:${mm}` };
    }
    case 'time': {
      return { value: String(rawValue) };
    }
    case 'checkbox': {
      const b = rawValue === true || rawValue === 'true' || rawValue === 1;
      const trueLabel = (opts.true_label as string | undefined) ?? 'Да';
      const falseLabel = (opts.false_label as string | undefined) ?? 'Нет';
      return { value: b ? trueLabel : falseLabel };
    }
    case 'select': {
      const v = String(rawValue);
      const choices = (opts.choices as Array<{ value: string; label: string }> | undefined) ?? [];
      const found = choices.find((c) => c.value === v);
      if (formatMod === 'value') return { value: v };
      return { value: found?.label ?? v };
    }
    case 'multiselect': {
      const arr = Array.isArray(rawValue) ? rawValue : [];
      const choices = (opts.choices as Array<{ value: string; label: string }> | undefined) ?? [];
      const separator = (opts.separator as string | undefined) ?? ', ';
      const mapped = arr.map((v) => {
        const found = choices.find((c) => c.value === String(v));
        return formatMod === 'value' ? String(v) : (found?.label ?? String(v));
      });
      return { value: mapped.join(separator) };
    }
    default:
      return { error: 'pf_value_type_mismatch' };
  }
}

async function resolvePfFieldToken(
  input: PackageTokenResolveInput,
  pfPublicId: string,
  _caseMod: string | undefined,
  formatMod: string | undefined,
): Promise<PackageTokenResolveResult> {
  // 1. Поле в каталоге
  const { data: fieldRow, error: fieldErr } = await input.supabase
    .from('document_package_field_catalog')
    .select('id, package_template_id, field_key, data_type, options, required, is_active, label')
    .eq('public_id', pfPublicId)
    .maybeSingle();
  if (fieldErr || !fieldRow) {
    return {
      resolved: false,
      code: 'pf_token_not_found',
      warning: `pf_token_not_found:${pfPublicId}`,
    };
  }
  const field = fieldRow as {
    id: string;
    package_template_id: string;
    field_key: string;
    data_type: string;
    options: Record<string, unknown> | null;
    required: boolean;
    is_active: boolean;
    label: string;
  };

  // 2. Принадлежность пакету
  if (input.packageTemplateItemId) {
    const { data: itemRow } = await input.supabase
      .from('document_package_template_items')
      .select('package_template_id')
      .eq('id', input.packageTemplateItemId)
      .maybeSingle();
    if (!itemRow) {
      return {
        resolved: false,
        code: 'config_error',
        warning: `package_template_item_not_found:${input.packageTemplateItemId}`,
      };
    }
    if ((itemRow as { package_template_id: string }).package_template_id !== field.package_template_id) {
      return {
        resolved: false,
        code: 'pf_token_outside_bound_package',
        warning: `pf_token_outside_bound_package:${pfPublicId}`,
      };
    }
  } else {
    const { data: sess } = await input.supabase
      .from('document_package_sessions')
      .select('package_template_id')
      .eq('id', input.packageSessionId)
      .maybeSingle();
    if (!sess) {
      return {
        resolved: false,
        code: 'config_error',
        warning: `session_not_found:${input.packageSessionId}`,
      };
    }
    if ((sess as { package_template_id: string }).package_template_id !== field.package_template_id) {
      return {
        resolved: false,
        code: 'pf_token_outside_bound_package',
        warning: `pf_token_outside_bound_package:${pfPublicId}`,
      };
    }
  }

  // 3. Значение из session_field_values
  //    Приоритет: per-item override → session-level fallback.
  let valueRow: Record<string, unknown> | null = null;
  if (input.packageTemplateItemId) {
    const { data: perItem, error: perItemErr } = await input.supabase
      .from('document_package_session_field_values')
      .select('value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json')
      .eq('session_id', input.packageSessionId)
      .eq('field_catalog_id', field.id)
      .eq('package_template_item_id', input.packageTemplateItemId)
      .maybeSingle();
    if (perItemErr) {
      return {
        resolved: false,
        code: 'config_error',
        warning: `pf_value_query_error:${pfPublicId}`,
      };
    }
    if (perItem) valueRow = perItem as Record<string, unknown>;
  }
  if (!valueRow) {
    const { data: sessionLevel, error: valErr } = await input.supabase
      .from('document_package_session_field_values')
      .select('value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json')
      .eq('session_id', input.packageSessionId)
      .eq('field_catalog_id', field.id)
      .is('package_template_item_id', null)
      .maybeSingle();
    if (valErr) {
      return {
        resolved: false,
        code: 'config_error',
        warning: `pf_value_query_error:${pfPublicId}`,
      };
    }
    if (sessionLevel) valueRow = sessionLevel as Record<string, unknown>;
  }

  let raw: unknown = null;
  if (valueRow) {
    const v = valueRow;
    switch (field.data_type) {
      case 'text':
      case 'select':
        raw = v.value_text;
        break;
      case 'number':
      case 'year':
        raw = v.value_number;
        break;
      case 'date':
        raw = v.value_date;
        break;
      case 'datetime':
        raw = v.value_datetime;
        break;
      case 'time':
        raw = v.value_time;
        break;
      case 'checkbox':
        raw = v.value_boolean;
        break;
      case 'multiselect':
        raw = v.value_json;
        break;
    }
  }

  if (raw == null || raw === '') {
    if (field.required) {
      return {
        resolved: false,
        code: 'pf_required_value_missing',
        warning: `pf_required_value_missing:${pfPublicId}`,
      };
    }
    // Soft empty value (как FLD): подставляем пусто, считаем resolved.
    return {
      resolved: true,
      value: '',
      aliasId: field.id,
      canonicalFieldPublicId: pfPublicId,
      roleKey: field.field_key,
      contextKind: 'package_custom_field',
    };
  }

  const formatted = formatPfValue(field.data_type, raw, field.options, formatMod);
  if ('error' in formatted) {
    return {
      resolved: false,
      code: formatted.error === 'pf_value_type_mismatch' ? 'pf_value_type_mismatch' : 'config_error',
      warning: `${formatted.error}:${pfPublicId}`,
    };
  }

  return {
    resolved: true,
    value: formatted.value,
    aliasId: field.id,
    canonicalFieldPublicId: pfPublicId,
    roleKey: field.field_key,
    contextKind: 'package_custom_field',
  };
}

/**
 * Pure resolver core. Use ONLY in dry-run edge function or in tests.
 * Не оборачивает feature-flag. Не пишет в БД. Не зовёт generation/snapshot.
 */
export async function resolvePackageTokenCore(
  input: PackageTokenResolveInput,
): Promise<PackageTokenResolveResult> {
  const { aliasToken, caseMod, formatMod, duplicateModifier } = parseRawToken(input.rawToken);
  if (duplicateModifier) {
    return {
      resolved: false,
      code: 'config_error',
      warning: `duplicate_modifier:${duplicateModifier}`,
    };
  }

  // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a: {{ln-XXXXXX.custom.<key>}}.
  // Должен проверяться ДО LN_SUB_RE, иначе sub-field-резолвер
  // зацепит `custom` как unknown sub-field.
  const LN_CUSTOM_RE = /^ln-(\d{6})\.custom\.([a-z][a-z0-9_]{0,49})$/;
  const lnCustomMatch = aliasToken.match(LN_CUSTOM_RE);
  if (lnCustomMatch) {
    return resolveLnCustomToken(input, `ln-${lnCustomMatch[1]}`, lnCustomMatch[2]);
  }

  // Sprint 3H-fix: канонический Word-токен роли — {{ln-XXXXXX}}.
  // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: sub-field вариант проверяется ДО основного.
  const LN_SUB_RE = /^ln-(\d{6})\.([a-z_]+)$/;
  const lnSubMatch = aliasToken.match(LN_SUB_RE);
  if (lnSubMatch) {
    return resolveLnSubFieldToken(input, `ln-${lnSubMatch[1]}`, lnSubMatch[2], caseMod, formatMod);
  }
  const LN_RE = /^ln-\d{6}$/;
  if (LN_RE.test(aliasToken)) {
    return resolveLnRoleToken(input, aliasToken, caseMod, formatMod);
  }

  // PATCH-PACKAGE-CUSTOM-FIELDS-V1: {{pf-XXXXXX}} (per-package custom field).
  // Никогда не падает в legacy alias-fallback.
  const PF_RE = /^pf-\d{6}$/;
  if (PF_RE.test(aliasToken)) {
    return resolvePfFieldToken(input, aliasToken, caseMod, formatMod);
  }


  // 1. Найти активный alias
  const { data: alias, error: aliasErr } = await input.supabase
    .from('document_package_token_aliases')
    .select('id, alias_token, canonical_field_public_id, role_key, context_kind, source_path')
    .eq('alias_token', aliasToken)
    .is('archived_at', null)
    .maybeSingle();

  if (aliasErr || !alias) {
    return { resolved: false, code: 'alias_missing', warning: `alias_not_found:${aliasToken}` };
  }

  // 2. Найти участника(ов) роли в сессии пакета.
  //    Sprint 3G: если задан packageTemplateItemId — читаем document-level
  //    SOT (`document_package_item_role_assignments`). Иначе — legacy
  //    package-scope participants.
  let participants: Array<{ person_id: string | null; metadata: unknown; entity_type?: string | null }> | null;
  let partErr: unknown;
  if (input.packageTemplateItemId) {
    // Резолвим role_catalog_id по PKR/role_key + package_template_id текущего item.
    const { data: itemRow, error: itemErr } = await input.supabase
      .from('document_package_template_items')
      .select('package_template_id')
      .eq('id', input.packageTemplateItemId)
      .maybeSingle();
    if (itemErr || !itemRow) {
      return {
        resolved: false,
        code: 'participant_missing',
        warning: `package_template_item_not_found:${input.packageTemplateItemId}`,
        aliasId: alias.id,
        roleKey: alias.role_key,
      };
    }
    const { data: roleRow, error: roleErr } = await input.supabase
      .from('document_package_role_catalog')
      .select('id')
      .eq('package_template_id', (itemRow as { package_template_id: string }).package_template_id)
      .eq('role_key', alias.role_key)
      .eq('is_active', true)
      .maybeSingle();
    if (roleErr || !roleRow) {
      return {
        resolved: false,
        code: 'participant_missing',
        warning: `role_catalog_not_found:${alias.role_key}`,
        aliasId: alias.id,
        roleKey: alias.role_key,
      };
    }
    const { data: rows, error } = await input.supabase
      .from('document_package_item_role_assignments')
      .select('person_id, metadata')
      .eq('package_session_id', input.packageSessionId)
      .eq('package_template_item_id', input.packageTemplateItemId)
      .eq('role_catalog_id', (roleRow as { id: string }).id)
      .eq('is_active', true);
    participants = (rows ?? []) as typeof participants;
    partErr = error;
  } else {
    const { data: rows, error } = await input.supabase
      .from('document_package_session_participants')
      .select('person_id, metadata, entity_type')
      .eq('package_session_id', input.packageSessionId)
      .eq('role_key', alias.role_key);
    participants = (rows ?? []) as typeof participants;
    partErr = error;
  }

  if (partErr) {
    return {
      resolved: false,
      code: 'participant_missing',
      warning: `participant_query_error:${alias.role_key}`,
      aliasId: alias.id,
      roleKey: alias.role_key,
    };
  }
  if (!participants || participants.length === 0) {
    return {
      resolved: false,
      code: 'participant_missing',
      warning: `participant_not_found:${alias.role_key}`,
      aliasId: alias.id,
      roleKey: alias.role_key,
    };
  }
  if (participants.length > 1) {
    return {
      resolved: false,
      code: 'multiple_role_assignments',
      warning: `multiple_role_assignments:${alias.role_key}:n=${participants.length}`,
      aliasId: alias.id,
      roleKey: alias.role_key,
    };
  }
  const participant = participants[0];


  // 3. Достать значение по context_kind
  let rawValue: unknown;
  if (alias.context_kind === 'package_person') {
    if (!participant.person_id) {
      return {
        resolved: false,
        code: 'no_person',
        warning: `person_id_null:${alias.role_key}`,
        aliasId: alias.id,
        roleKey: alias.role_key,
      };
    }
    const { data: person, error: personErr } = await input.supabase
      .from('legal_details_persons')
      .select('full_name')
      .eq('id', participant.person_id)
      .maybeSingle();
    if (personErr || !person) {
      return {
        resolved: false,
        code: 'person_missing',
        warning: 'person_not_found',
        aliasId: alias.id,
        roleKey: alias.role_key,
      };
    }
    rawValue = (person as { full_name?: string | null }).full_name;
  } else if (alias.context_kind === 'package_metadata') {
    if (!alias.source_path) {
      return {
        resolved: false,
        code: 'config_error',
        warning: 'source_path_missing',
        aliasId: alias.id,
        roleKey: alias.role_key,
      };
    }
    rawValue = readJsonPath({ metadata: participant.metadata }, alias.source_path);
  } else {
    return {
      resolved: false,
      code: 'config_error',
      warning: `unknown_context_kind:${alias.context_kind}`,
      aliasId: alias.id,
      roleKey: alias.role_key,
    };
  }

  if (rawValue == null || rawValue === '') {
    return {
      resolved: false,
      code: 'empty_value',
      warning: `value_empty:${aliasToken}`,
      aliasId: alias.id,
      roleKey: alias.role_key,
    };
  }

  const value = String(rawValue);

  // |case= модификатор — placeholder. Полная интеграция inflectRu/inflectCompanyName
  // через case-format.ts произойдёт при wiring в Sprint 3D.
  if (caseMod && isCaseModifier(caseMod)) {
    // identity для Sprint 3C; безопасно совпадает с case-format default-fallback.
  }

  return {
    resolved: true,
    value,
    aliasId: alias.id,
    canonicalFieldPublicId: alias.canonical_field_public_id!,
    roleKey: alias.role_key,
    contextKind: alias.context_kind,
  };
}

/**
 * Public, feature-flag-guarded entry point. Production-imports допустимы только
 * через эту функцию; пока HARDCODED_ENABLED=false — всегда возвращает FEATURE_DISABLED.
 */
export async function resolvePackageToken(
  input: PackageTokenResolveInput,
): Promise<PackageTokenResolveResult> {
  if (!HARDCODED_ENABLED) return FEATURE_DISABLED();
  return resolvePackageTokenCore(input);
}

// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3
// ----------------------------------------------------------------------------
// {{tableRepeat:TR-XXXXXX}} — structured dry-run resolver.
//
// Контракт (НЕ применяется в canonical-document-generate-strict; только в
// package-tokens-dry-run, super_admin gated):
//   • Source-of-truth конфигов: document_package_template_items.metadata.table_repeats[]
//   • Source-of-truth строк:    document_package_item_role_assignments
//                               (session+item+role, is_active=true, ordered).
//   • Per-row context: каждая строка резолвится для своего assignment отдельно;
//     scalar `resolveLnCustomToken`/`resolveLnSubFieldToken` НЕ переиспользуются
//     (их multi-policy ломала бы preview с 2+ участниками).
//   • Длина каждой cell.value ограничена 200 символами (truncated:true иначе).
//   • Превью ограничено первыми 5 строками (truncated_rows:true иначе).
//   • Не пишет в БД, не возвращает чувствительные данные за пределы preview.
// ============================================================================

export const TABLE_REPEAT_PREVIEW_MAX_ROWS = 5;
export const TABLE_REPEAT_CELL_VALUE_MAX_CHARS = 200;

export type TableRepeatResolveCode =
  | 'tr_no_template_item'
  | 'tr_id_not_found'
  | 'tr_role_has_no_assignments'
  | 'tr_config_invalid'
  | 'tr_column_resolve_failed';

export interface TableRepeatCellPreview {
  cell_index: number;
  source_type: string;
  source_key?: string;
  value: string | null;
  truncated?: boolean;
  hint?: string;       // e.g. 'package_field_same_for_all_rows'
  code?: string;       // non-empty when cell could not be resolved
}

export interface TableRepeatRowPreview {
  row_number: number;
  cells: TableRepeatCellPreview[];
}

export interface TableRepeatColumnSummary {
  cell_index: number;
  source_type: string;
  source_key?: string;
  hint?: string;
}

export type TableRepeatResolveResult =
  | {
      resolved: true;
      kind: 'package_table_repeat';
      tr_id: string;
      role_catalog_id: string;
      role_key: string;
      rows_count: number;
      rows_preview_limit: number;
      rows_preview_truncated: boolean;
      columns: TableRepeatColumnSummary[];
      rows_preview: TableRepeatRowPreview[];
      cell_codes_summary: Record<string, number>;
    }
  | {
      resolved: false;
      kind: 'package_table_repeat';
      tr_id: string;
      code: TableRepeatResolveCode;
      warning: string;
      issues?: TableRepeatIssue[];
    };

export interface TableRepeatResolveInput {
  trId: string;
  packageSessionId: string;
  packageTemplateItemId: string | null;
  supabase: SupabaseClient;
  /** super_admin → разрешён source_type='assignment_metadata'. */
  isSuperAdmin?: boolean;
}

function truncateForPreview(raw: string): { value: string; truncated: boolean } {
  if (raw.length <= TABLE_REPEAT_CELL_VALUE_MAX_CHARS) return { value: raw, truncated: false };
  return {
    value: raw.slice(0, TABLE_REPEAT_CELL_VALUE_MAX_CHARS) + '…',
    truncated: true,
  };
}

// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4 parity DoD:
// Cell renderer helpers перенесены в `_shared/table-repeat-cell-render.ts`
// и реюзаются как dry-run preview (E.3), так и real DOCX expansion (E.4).
// Импорт ниже сохраняет внешний контракт `resolveTableRepeatTokenCore`.
import {
  renderRolePersonCell,
  readAssignmentCustomKey,
  readAssignmentMetadataPath,
} from './table-repeat-cell-render.ts';

export async function resolveTableRepeatTokenCore(
  input: TableRepeatResolveInput,
): Promise<TableRepeatResolveResult> {
  const { trId } = input;

  if (!input.packageTemplateItemId) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_no_template_item',
      warning: 'tr_token_requires_package_template_item_id',
    };
  }

  // 1. item.metadata.table_repeats[] + package_template_id
  const { data: itemRow, error: itemErr } = await input.supabase
    .from('document_package_template_items')
    .select('id, package_template_id, metadata')
    .eq('id', input.packageTemplateItemId)
    .maybeSingle();
  if (itemErr || !itemRow) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_id_not_found',
      warning: `package_template_item_not_found:${input.packageTemplateItemId}`,
    };
  }
  const item = itemRow as { id: string; package_template_id: string; metadata: unknown };
  const configs = readTableRepeats(item.metadata);
  const cfg = configs.find((c) => c.id === trId);
  if (!cfg) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_id_not_found',
      warning: `tr_id_not_found_in_item_metadata:${trId}`,
    };
  }

  // 2. Validate config (errors block; warnings/orphan-keys пропускаем).
  const cfgIssues = validateTableRepeatConfig(cfg);
  const cfgErrors = cfgIssues.filter((i) => i.severity === 'error');
  if (cfgErrors.length > 0) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_config_invalid',
      warning: `tr_config_invalid:n=${cfgErrors.length}`,
      issues: cfgIssues,
    };
  }

  // 3. role catalog row (для role_key + проверка package match)
  const { data: roleRow } = await input.supabase
    .from('document_package_role_catalog')
    .select('id, package_template_id, role_key, metadata')
    .eq('id', cfg.role_catalog_id)
    .maybeSingle();
  if (!roleRow) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_config_invalid',
      warning: `role_catalog_not_found:${cfg.role_catalog_id}`,
    };
  }
  const role = roleRow as { id: string; package_template_id: string; role_key: string; metadata: unknown };
  if (role.package_template_id !== item.package_template_id) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_config_invalid',
      warning: `role_outside_bound_package:${cfg.role_catalog_id}`,
    };
  }

  // 4. assignments (session + item + role, active, ordered).
  const { data: asgs } = await input.supabase
    .from('document_package_item_role_assignments')
    .select('person_id, metadata, sort_order, created_at')
    .eq('package_session_id', input.packageSessionId)
    .eq('package_template_item_id', input.packageTemplateItemId)
    .eq('role_catalog_id', role.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const assignments = ((asgs ?? []) as Array<{ person_id: string | null; metadata: unknown }>);
  if (assignments.length === 0) {
    return {
      resolved: false,
      kind: 'package_table_repeat',
      tr_id: trId,
      code: 'tr_role_has_no_assignments',
      warning: `tr_role_has_no_assignments:${cfg.role_catalog_id}`,
    };
  }

  // 5. Persons batch (для role_person)
  const needPersonRows = cfg.columns.some((c) => c.source_type === 'role_person');
  const personIds = assignments.map((a) => a.person_id).filter((x): x is string => !!x);
  const personById = new Map<string, Record<string, unknown>>();
  if (needPersonRows && personIds.length > 0) {
    const { data: persons } = await input.supabase
      .from('legal_details_persons')
      .select('*')
      .in('id', personIds);
    for (const p of (persons ?? []) as Array<Record<string, unknown>>) {
      personById.set(String((p as { id: string }).id), p);
    }
  }

  // 6. package_field pre-resolve (одно значение на все строки).
  const pfCache = new Map<string, { value: string; code?: string; hint?: string }>();
  const pfCols = cfg.columns.filter((c) => c.source_type === 'package_field' && c.source_key);
  for (const c of pfCols) {
    const pfId = c.source_key!;
    if (pfCache.has(pfId)) continue;
    const r = await resolvePfFieldToken(
      {
        rawToken: pfId,
        packageSessionId: input.packageSessionId,
        packageTemplateItemId: input.packageTemplateItemId,
        supabase: input.supabase,
      },
      pfId,
      undefined,
      c.format,
    );
    if (r.resolved) {
      pfCache.set(pfId, { value: r.value, hint: 'package_field_same_for_all_rows' });
    } else {
      pfCache.set(pfId, { value: '', code: r.code, hint: 'package_field_same_for_all_rows' });
    }
  }

  // 7. Build rows preview (≤5).
  const rowsCount = assignments.length;
  const previewCount = Math.min(rowsCount, TABLE_REPEAT_PREVIEW_MAX_ROWS);
  const rowsPreview: TableRepeatRowPreview[] = [];
  const codeCounter: Record<string, number> = {};

  for (let i = 0; i < previewCount; i += 1) {
    const asg = assignments[i];
    const person = asg.person_id ? personById.get(asg.person_id) : undefined;
    const cells: TableRepeatCellPreview[] = [];
    for (const col of cfg.columns) {
      let raw = '';
      let code: string | undefined;
      let hint: string | undefined;

      if (col.source_type === 'role_person') {
        const r = renderRolePersonCell(col, person);
        raw = r.value; code = r.code;
      } else if (col.source_type === 'assignment_custom_field') {
        if (!col.source_key) { code = 'missing_source_key'; }
        else {
          const r = readAssignmentCustomKey(asg, col.source_key);
          raw = r.value; code = r.code;
        }
      } else if (col.source_type === 'package_field') {
        if (!col.source_key) { code = 'missing_source_key'; }
        else {
          const cached = pfCache.get(col.source_key);
          raw = cached?.value ?? '';
          code = cached?.code;
          hint = cached?.hint;
        }
      } else if (col.source_type === 'static_text') {
        raw = col.source_key ?? '';
      } else if (col.source_type === 'row_number') {
        raw = String(i + 1);
      } else if (col.source_type === 'empty') {
        raw = '';
      } else if (col.source_type === 'assignment_metadata') {
        if (!input.isSuperAdmin) {
          code = 'tr_metadata_source_super_admin_only';
        } else if (!col.source_key) {
          code = 'missing_source_key';
        } else {
          const r = readAssignmentMetadataPath(asg, col.source_key);
          raw = r.value; code = r.code;
        }
      } else {
        code = 'tr_column_resolve_failed';
      }

      if (code) codeCounter[code] = (codeCounter[code] ?? 0) + 1;
      const truncated = truncateForPreview(raw);
      cells.push({
        cell_index: col.cell_index,
        source_type: col.source_type,
        source_key: col.source_key,
        value: code ? null : truncated.value,
        truncated: truncated.truncated || undefined,
        hint,
        code,
      });
    }
    rowsPreview.push({ row_number: i + 1, cells });
  }

  const columnsSummary: TableRepeatColumnSummary[] = cfg.columns.map((col) => ({
    cell_index: col.cell_index,
    source_type: col.source_type,
    source_key: col.source_key,
    hint: col.source_type === 'package_field' ? 'package_field_same_for_all_rows' : undefined,
  }));

  return {
    resolved: true,
    kind: 'package_table_repeat',
    tr_id: trId,
    role_catalog_id: role.id,
    role_key: role.role_key,
    rows_count: rowsCount,
    rows_preview_limit: TABLE_REPEAT_PREVIEW_MAX_ROWS,
    rows_preview_truncated: rowsCount > TABLE_REPEAT_PREVIEW_MAX_ROWS,
    columns: columnsSummary,
    rows_preview: rowsPreview,
    cell_codes_summary: codeCounter,
  };
}

