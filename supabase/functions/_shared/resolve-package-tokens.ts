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
import type { RuCase } from './ru-inflection.ts';

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
  // PATCH-PACKAGE-CUSTOM-FIELDS-V1: pf-XXXXXX branch
  | 'pf_token_not_found'
  | 'pf_token_outside_bound_package'
  | 'pf_value_missing'
  | 'pf_required_value_missing'
  | 'pf_invalid_choice'
  | 'pf_value_type_mismatch'
  | 'pf_unsupported_modifier';

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
  const { data: valueRow, error: valErr } = await input.supabase
    .from('document_package_session_field_values')
    .select('value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json')
    .eq('session_id', input.packageSessionId)
    .eq('field_catalog_id', field.id)
    .maybeSingle();
  if (valErr) {
    return {
      resolved: false,
      code: 'config_error',
      warning: `pf_value_query_error:${pfPublicId}`,
    };
  }

  let raw: unknown = null;
  if (valueRow) {
    const v = valueRow as Record<string, unknown>;
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

  // Sprint 3H-fix: канонический Word-токен роли — {{ln-XXXXXX}}.
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
