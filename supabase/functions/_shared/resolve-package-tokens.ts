// ============================================================================
// resolve-package-tokens.ts — Sprint 3B v2.1 SKELETON (isolated, NOT WIRED)
// ----------------------------------------------------------------------------
// Резолвер пакетных alias-токенов (`package.roles.<role_key>.<field>`).
//
// СТАТУС: ИЗОЛИРОВАННЫЙ SKELETON. Не импортируется production-кодом.
//        `canonical-document-generate-strict` НЕ изменён. Feature flag
//        отсутствует в БД → жёстко выключен через HARDCODED_ENABLED=false.
//        Routing-точка переносится в Sprint 3C.
//
// Контракты:
//   - SOT alias'ов:        public.document_package_token_aliases
//   - SOT персон:          public.legal_details_persons (по person_id)
//   - SOT участников роли: public.document_package_session_participants
//   - Field-ID first:      canonical_field_public_id → fields_registry.public_id
//
// Default-deny: любой неразрешённый случай возвращает { resolved:false, warning }.
// Запрещено: fallback на legal_details_entity_person_links, чтение из legacy
//            document_token_aliases, вызов billing/customer/executor резолверов.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { isCaseModifier, type CaseContext } from './case-format.ts';

/** Жёсткий выключатель Sprint 3B v2.1. Включение — отдельный Sprint 3C. */
export const HARDCODED_ENABLED = false;

export interface PackageTokenResolveInput {
  /** Полный токен вида `package.roles.<role>.<field>` или с модификатором `|case=genitive`. */
  rawToken: string;
  /** uuid сессии пакета документов (document_package_sessions.id). */
  packageSessionId: string;
  /** Supabase client с правами на чтение трёх SOT-таблиц (обычно service-role). */
  supabase: SupabaseClient;
  /** Опциональный контекст для |case= (передаётся напрямую в case-format). */
  caseContext?: Omit<CaseContext, 'tokenKey'>;
}

export type PackageTokenResolveResult =
  | { resolved: true; value: string; aliasId: string; canonicalFieldPublicId: string }
  | { resolved: false; warning: string; code: string };

const FEATURE_DISABLED = (): PackageTokenResolveResult => ({
  resolved: false,
  warning: 'package_resolver_disabled',
  code: 'feature_off',
});

/** Парсит `alias|mod1=val1|mod2=val2` → { aliasToken, modifiers }. */
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

/** Безопасный jsonpath-walker: `metadata.position` → obj.metadata?.position. */
function readJsonPath(root: unknown, path: string): unknown {
  if (root == null || !path) return undefined;
  let cur: any = root;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Resolve package alias token.
 *
 * Реализация — minimal viable skeleton. Полная интеграция (case-format,
 * routing в canonical-document-generate-strict) — Sprint 3C.
 */
export async function resolvePackageToken(
  input: PackageTokenResolveInput,
): Promise<PackageTokenResolveResult> {
  if (!HARDCODED_ENABLED) return FEATURE_DISABLED();

  const { aliasToken, caseMod } = parseRawToken(input.rawToken);

  // 1. Найти активный alias
  const { data: alias, error: aliasErr } = await input.supabase
    .from('document_package_token_aliases')
    .select('id, alias_token, canonical_field_public_id, role_key, context_kind, source_path')
    .eq('alias_token', aliasToken)
    .is('archived_at', null)
    .maybeSingle();

  if (aliasErr || !alias) {
    return { resolved: false, warning: `alias_not_found:${aliasToken}`, code: 'alias_missing' };
  }

  // 2. Найти участника роли в сессии пакета
  const { data: participant, error: partErr } = await input.supabase
    .from('document_package_session_participants')
    .select('person_id, metadata')
    .eq('package_session_id', input.packageSessionId)
    .eq('role_key', alias.role_key)
    .maybeSingle();

  if (partErr || !participant) {
    return {
      resolved: false,
      warning: `participant_not_found:${alias.role_key}`,
      code: 'participant_missing',
    };
  }

  // 3. Достать значение по context_kind
  let rawValue: unknown;
  if (alias.context_kind === 'package_person') {
    if (!participant.person_id) {
      return { resolved: false, warning: `person_id_null:${alias.role_key}`, code: 'no_person' };
    }
    const { data: person, error: personErr } = await input.supabase
      .from('legal_details_persons')
      .select('full_name')
      .eq('id', participant.person_id)
      .maybeSingle();
    if (personErr || !person) {
      return { resolved: false, warning: `person_not_found`, code: 'person_missing' };
    }
    rawValue = person.full_name;
  } else if (alias.context_kind === 'package_metadata') {
    if (!alias.source_path) {
      return { resolved: false, warning: 'source_path_missing', code: 'config_error' };
    }
    rawValue = readJsonPath({ metadata: participant.metadata }, alias.source_path);
  } else {
    return { resolved: false, warning: `unknown_context_kind`, code: 'config_error' };
  }

  if (rawValue == null || rawValue === '') {
    return { resolved: false, warning: `value_empty:${aliasToken}`, code: 'empty_value' };
  }

  let value = String(rawValue);

  // 4. |case= модификатор (placeholder — полная интеграция в Sprint 3C)
  if (caseMod && isCaseModifier(caseMod)) {
    // NOTE: пока возвращаем исходное значение; интеграция inflectRu/inflectCompanyName
    // через case-format.ts произойдёт при wiring в canonical-document-generate-strict.
    // Это безопасно: default behaviour = identity, как и в case-format при unsupported.
  }

  return {
    resolved: true,
    value,
    aliasId: alias.id,
    canonicalFieldPublicId: alias.canonical_field_public_id!,
  };
}
