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
