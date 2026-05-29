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

/** Жёсткий выключатель: production-вызов всегда возвращает FEATURE_DISABLED. */
export const HARDCODED_ENABLED = false;

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
  | 'role_assignment_missing';

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

function parseRawToken(raw: string): { aliasToken: string; caseMod?: string } {
  const parts = raw.split('|').map((s) => s.trim());
  const aliasToken = parts[0];
  let caseMod: string | undefined;
  for (const seg of parts.slice(1)) {
    const [k, v] = seg.split('=').map((s) => s?.trim());
    if (k === 'case' && v) caseMod = v;
  }
  return { aliasToken, caseMod };
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
  _caseMod: string | undefined,
): Promise<PackageTokenResolveResult> {
  if (!input.packageTemplateItemId) {
    return {
      resolved: false,
      code: 'config_error',
      warning: 'ln_token_requires_package_template_item_id',
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
  const assignments = (rows ?? []) as Array<{ person_id: string | null; metadata: unknown }>;
  if (assignments.length === 0) {
    return {
      resolved: false,
      code: 'role_assignment_missing',
      warning: `role_assignment_missing:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  // Multi-assignment: берём первого по sort_order/created_at + warning.
  let multiWarning: PackageTokenResolveResult | null = null;
  if (assignments.length > 1) {
    multiWarning = {
      resolved: false,
      code: 'multiple_role_assignments',
      warning: `multiple_role_assignments:${lnPublicId}:n=${assignments.length}`,
      roleKey: role.role_key,
    };
  }

  const first = assignments[0];
  if (!first.person_id) {
    return {
      resolved: false,
      code: 'no_person',
      warning: `person_id_null:${role.role_key}`,
      roleKey: role.role_key,
    };
  }

  const { data: person, error: personErr } = await input.supabase
    .from('legal_details_persons')
    .select('full_name')
    .eq('id', first.person_id)
    .maybeSingle();
  if (personErr || !person) {
    return {
      resolved: false,
      code: 'person_missing',
      warning: 'person_not_found',
      roleKey: role.role_key,
    };
  }
  const fullName = ((person as { full_name?: string | null }).full_name ?? '').trim();
  const positionRaw = readJsonPath({ metadata: first.metadata }, 'metadata.position');
  const position = positionRaw == null ? '' : String(positionRaw).trim();

  // output_template (Sprint 3H): default "{{position}}, {{full_name}}";
  // если position пуст — только ФИО (без ведущей запятой).
  const tpl = role.output_template ?? '{{position}}, {{full_name}}';
  let value = tpl
    .replace(/\{\{\s*full_name\s*\}\}/g, fullName)
    .replace(/\{\{\s*position\s*\}\}/g, position);
  if (!position) {
    // Снять "висячие" ведущие/двойные запятые при пустой должности.
    value = value.replace(/^\s*,\s*/, '').replace(/,\s*,/g, ',').trim();
  }

  if (!value) {
    return {
      resolved: false,
      code: 'empty_value',
      warning: `value_empty:${lnPublicId}`,
      roleKey: role.role_key,
    };
  }

  if (multiWarning) return multiWarning;

  return {
    resolved: true,
    value,
    aliasId: role.id, // переиспользуем поле под role_catalog_id
    canonicalFieldPublicId: lnPublicId,
    roleKey: role.role_key,
    contextKind: 'package_role_ln',
  };
}

/**
 * Pure resolver core. Use ONLY in dry-run edge function or in tests.
 * Не оборачивает feature-flag. Не пишет в БД. Не зовёт generation/snapshot.
 */
export async function resolvePackageTokenCore(
  input: PackageTokenResolveInput,
): Promise<PackageTokenResolveResult> {
  const { aliasToken, caseMod } = parseRawToken(input.rawToken);

  // Sprint 3H-fix: канонический Word-токен роли — {{ln-XXXXXX}}.
  // Резолвим напрямую через document_package_role_catalog.public_id +
  // document_package_item_role_assignments (document-level SOT).
  const LN_RE = /^ln-\d{6}$/;
  if (LN_RE.test(aliasToken)) {
    return resolveLnRoleToken(input, aliasToken, caseMod);
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
