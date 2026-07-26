/**
 * placeholderClassifier — canonical SHARED helper (PATCH-PACKAGE-CUSTOM-FIELDS-V1, итерация 2).
 *
 * Этот файл — единственный источник истины для классификации синтаксиса плейсхолдеров
 * `{{...}}` в шаблонах. Используется одновременно фронтом и edge-функциями.
 *
 * Поддерживаемые виды токенов:
 *   field:FLD-XXXXXX[|format=...|case=...]      — биллинговое FLD-поле
 *   package.<ul|ip|fl>.FLD-XXXXXX[|...]         — реквизит пакета
 *   ln-XXXXXX[|...]                             — роль пакета (канон Sprint 3H)
 *   pf-XXXXXX[|...]                             — кастомное поле пакета (Sprint B)
 *
 * Legacy (error):
 *   package.role.PKR-XXXXXX                     — invalid_legacy_role_placeholder
 *   package.roles.<key>.<sub>                   — invalid_legacy_role_placeholder
 *   document.* / executor.* / customer.* / deal.* / cf.* — legacy_placeholder_format_detected
 *
 * Контракт модификаторов:
 *   - format=words | text   (для field/pf/package.*)
 *   - format=full | short | signature_short (для ln)
 *   - case=nominative | genitive | dative | accusative | instrumental | prepositional
 *   Любой другой ключ → unknown_modifier.
 *   Любое другое значение известного ключа → invalid_modifier_value.
 *
 * Контекст (scope):
 *   - 'billing'  — standalone billing-шаблон; разрешены ТОЛЬКО field-токены.
 *                  package/ln/pf → reason 'package_token_outside_package_context'.
 *   - 'package'  — шаблон в составе пакета; разрешены все 4 синтаксиса.
 *   - 'unknown'  — scope ещё не определён (например, ручная активация без явного binding):
 *                  все синтаксисы трактуются как syntactically valid;
 *                  фактический контекст-гейт выполняется выше (apply-markup проверяет
 *                  document_package_template_items для pf-*).
 *
 * !!! Этот модуль ОБЯЗАН быть pure: никакого I/O, никаких Deno/Node globals, никаких
 * импортов из @supabase/supabase-js. Парность с фронтом гарантируется тестом
 * placeholderClassifier.parity.test (см. supabase/functions/_shared/).
 */

export type PlaceholderFormat = 'words' | 'text' | 'full' | 'short' | 'signature_short' | 'long';
export type PlaceholderCase =
  | 'nominative' | 'genitive' | 'dative'
  | 'accusative' | 'instrumental' | 'prepositional';

export type PlaceholderScope = 'billing' | 'package' | 'unknown';

export type PlaceholderClassification =
  | {
      kind: 'field';
      public_id: string;          // FLD-XXXXXX
      format: PlaceholderFormat | null;
      case_modifier: PlaceholderCase | null;
    }
  | {
      kind: 'package_field';      // pf-XXXXXX
      public_id: string;
      format: PlaceholderFormat | null;
      case_modifier: PlaceholderCase | null;
    }
  | {
      kind: 'package_role';       // ln-XXXXXX
      public_id: string;
      format: PlaceholderFormat | null;
      case_modifier: PlaceholderCase | null;
    }
  | {
      // PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: ln-XXXXXX.<sub_field>
      kind: 'package_role_subfield';
      public_id: string;          // ln-XXXXXX
      sub_field: string;          // whitelist на резолвере (LN_SUB_FIELD_SPECS)
      format: PlaceholderFormat | string | null;  // 'dotted'|'short'|'full' для date или name-format
      case_modifier: PlaceholderCase | null;
    }
  | {
      // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a:
      //   {{ln-XXXXXX.custom.<key>}} — scalar custom assignment field.
      //   Резолв только в package-tokens-dry-run; реальная DOCX-подстановка → Stage E.4.
      kind: 'package_role_custom_field';
      public_id: string;
      custom_key: string;
      case_modifier: PlaceholderCase | null;
    }
  | {
      // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3:
      //   {{tableRepeat:TR-XXXXXX}} — service marker, помечающий строку DOCX-таблицы,
      //   которая в Stage E.4 будет размножена по числу активных назначений роли.
      //   Без модификаторов в v1: любые `|format=...` дадут `invalid`.
      kind: 'package_table_repeat';
      public_id: string;  // TR-XXXXXX
    }
  | {
      kind: 'package_requisite';  // package.ul|ip|fl.FLD-XXXXXX
      entity: 'ul' | 'ip' | 'fl';
      public_id: string;
      format: PlaceholderFormat | null;
      case_modifier: PlaceholderCase | null;
    }
  | {
      kind: 'company_field';
      key: string;
      format: PlaceholderFormat | null;
      case_modifier: PlaceholderCase | null;
    }
  | { kind: 'legacy_role_format' }       // package.role.PKR-* / package.roles.*
  | { kind: 'legacy_namespace'; ns: string } // document.*/executor.*/customer.*/deal.*/cf.*
  | { kind: 'unknown_modifier'; modifier: string }
  | { kind: 'invalid_modifier_value'; key: string; value: string }
  | { kind: 'invalid' };

// FORMATS_BILLING расширен под ФИО-модификаторы: `full|short|signature_short`
// разрешены syntax-wise для field:FLD-* (per-FLD семантика — на резолвере,
// см. PERSON_NAME_FIELD_KEYS в canonical-document-generate-strict). Это зеркалит
// поведение package_requisite и нужно для полей «Руководитель ФИО» (Исполнитель ЮЛ,
// Заказчик ЮЛ, Заказчик ИП).
const FORMATS_BILLING = new Set<PlaceholderFormat>([
  'words', 'text', 'full', 'short', 'signature_short',
]);
const FORMATS_LN = new Set<PlaceholderFormat>(['full', 'short', 'signature_short']);
// package_requisite держит и биллинговые (суммы/даты: words|text), и
// персоналии/орг-форму (full|short|signature_short|long). Per-FLD семантика
// форматов — на резолвере (canonical-document-generate-strict).
const FORMATS_PACKAGE_REQUISITE = new Set<PlaceholderFormat>([
  'words', 'text', 'full', 'short', 'signature_short', 'long',
]);
const CASES = new Set<PlaceholderCase>([
  'nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional',
]);

const RE_FIELD          = /^field:(FLD-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
const RE_PACKAGE_REQ    = /^package\.(ul|ip|fl)\.(FLD-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3: {{tableRepeat:TR-XXXXXX}}.
// Без модификаторов в v1 — `tableRepeat:TR-XXXXXX|format=...` regex не матчит и
// пойдёт в `invalid` (см. evaluatePlaceholderInScope → legacy_placeholder_format_detected).
const RE_PACKAGE_TABLE_REPEAT = /^tableRepeat:(TR-\d{6,})$/;
const RE_PACKAGE_ROLE   = /^(ln-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a — проверять ДО RE_PACKAGE_ROLE_SUB.
const RE_PACKAGE_ROLE_CUSTOM = /^(ln-\d{6})\.custom\.([a-z][a-z0-9_]{0,49})((?:\|[a-z_]+=[a-z_]+)*)$/;
// PATCH-ROLE-SCOPED-PERSON-PLACEHOLDERS-V1: {{ln-XXXXXX.<sub_field>[|...]}}.
// Sub-field whitelist валидируется backend-резолвером (LN_SUB_FIELD_SPECS);
// классификатор остаётся pure-синтаксическим.
const RE_PACKAGE_ROLE_SUB = /^(ln-\d{6})\.([a-z_]+)((?:\|[a-z_]+=[a-z_]+)*)$/;
const RE_PACKAGE_FIELD  = /^(pf-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
const RE_COMPANY_FIELD  = /^(company\.(?:full_name|short_name|unp|legal_address|director\.name|director\.position|bank\.account|bank\.name|public_id))((?:\|[a-z_]+=[a-z_]+)*)$/;
const RE_LEGACY_PKR     = /^package\.role\.PKR-\d{6}(?:\|[^}]*)?$/;
const RE_LEGACY_ROLES   = /^package\.roles\.[a-z_][a-z0-9_]*\.[a-z_]+(?:\|[^}]*)?$/;
const RE_LEGACY_NS      = /^(document|executor|customer|deal|cf)\./i;

interface ModifierResult {
  format: PlaceholderFormat | null;
  case_modifier: PlaceholderCase | null;
  /** non-null → классифицировать как unknown_modifier / invalid_modifier_value */
  error?:
    | { kind: 'unknown_modifier'; modifier: string }
    | { kind: 'invalid_modifier_value'; key: string; value: string };
}

function parseModifiers(tail: string, allowedFormats: Set<PlaceholderFormat>): ModifierResult {
  const out: ModifierResult = { format: null, case_modifier: null };
  if (!tail) return out;
  const parts = tail.split('|').filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      out.error = { kind: 'unknown_modifier', modifier: part };
      return out;
    }
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === 'format') {
      if (!allowedFormats.has(v as PlaceholderFormat)) {
        out.error = { kind: 'invalid_modifier_value', key: 'format', value: v };
        return out;
      }
      out.format = v as PlaceholderFormat;
    } else if (k === 'case') {
      if (!CASES.has(v as PlaceholderCase)) {
        out.error = { kind: 'invalid_modifier_value', key: 'case', value: v };
        return out;
      }
      out.case_modifier = v as PlaceholderCase;
    } else {
      out.error = { kind: 'unknown_modifier', modifier: `${k}=${v}` };
      return out;
    }
  }
  return out;
}

/**
 * Чистая синтаксическая классификация одного `inside` (содержимое внутри `{{…}}`).
 * Не делает контекстных проверок (scope). См. evaluatePlaceholderInScope.
 */
export function classifyPlaceholder(inside: string): PlaceholderClassification {
  const raw = inside.trim();

  const mField = raw.match(RE_FIELD);
  if (mField) {
    const mods = parseModifiers(mField[2] || '', FORMATS_BILLING);
    if (mods.error) return mods.error;
    return { kind: 'field', public_id: mField[1], format: mods.format, case_modifier: mods.case_modifier };
  }

  const mReq = raw.match(RE_PACKAGE_REQ);
  if (mReq) {
    const mods = parseModifiers(mReq[3] || '', FORMATS_PACKAGE_REQUISITE);
    if (mods.error) return mods.error;
    return {
      kind: 'package_requisite',
      entity: mReq[1] as 'ul' | 'ip' | 'fl',
      public_id: mReq[2],
      format: mods.format,
      case_modifier: mods.case_modifier,
    };
  }

  const mCompany = raw.match(RE_COMPANY_FIELD);
  if (mCompany) {
    const mods = parseModifiers(mCompany[2] || '', new Set<PlaceholderFormat>(['text', 'full', 'short', 'signature_short']));
    if (mods.error) return mods.error;
    return { kind: 'company_field', key: mCompany[1], format: mods.format, case_modifier: mods.case_modifier };
  }

  // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.3: {{tableRepeat:TR-XXXXXX}}.
  // Никаких модификаторов: с `|...` regex не матчит, проваливается в `invalid`.
  const mTr = raw.match(RE_PACKAGE_TABLE_REPEAT);
  if (mTr) {
    return { kind: 'package_table_repeat', public_id: mTr[1] };
  }


  // PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.1a: {{ln-XXXXXX.custom.<key>}}.
  const mRoleCustom = raw.match(RE_PACKAGE_ROLE_CUSTOM);
  if (mRoleCustom) {
    const FORMATS_LN_CUSTOM = new Set<PlaceholderFormat>();
    const mods = parseModifiers(mRoleCustom[3] || '', FORMATS_LN_CUSTOM);
    if (mods.error) return mods.error;
    return {
      kind: 'package_role_custom_field',
      public_id: mRoleCustom[1],
      custom_key: mRoleCustom[2],
      case_modifier: mods.case_modifier,
    };
  }

  const mRoleSub = raw.match(RE_PACKAGE_ROLE_SUB);
  if (mRoleSub) {
    // Допустимый набор format-значений для sub-field шире обычного name-формата
    // (включая 'dotted' для дат). Полная валидация по whitelist sub_field —
    // на резолвере; здесь принимаем любой синтаксически валидный модификатор.
    const FORMATS_LN_SUB = new Set<PlaceholderFormat | string>([
      'full', 'short', 'signature_short', 'dotted',
    ]);
    const mods = parseModifiers(mRoleSub[3] || '', FORMATS_LN_SUB as Set<PlaceholderFormat>);
    if (mods.error) return mods.error;
    return {
      kind: 'package_role_subfield',
      public_id: mRoleSub[1],
      sub_field: mRoleSub[2],
      format: mods.format,
      case_modifier: mods.case_modifier,
    };
  }

  const mRole = raw.match(RE_PACKAGE_ROLE);
  if (mRole) {
    const mods = parseModifiers(mRole[2] || '', FORMATS_LN);
    if (mods.error) return mods.error;
    return { kind: 'package_role', public_id: mRole[1], format: mods.format, case_modifier: mods.case_modifier };
  }

  const mPf = raw.match(RE_PACKAGE_FIELD);
  if (mPf) {
    const mods = parseModifiers(mPf[2] || '', FORMATS_BILLING);
    if (mods.error) return mods.error;
    return { kind: 'package_field', public_id: mPf[1], format: mods.format, case_modifier: mods.case_modifier };
  }

  if (RE_LEGACY_PKR.test(raw) || RE_LEGACY_ROLES.test(raw)) {
    return { kind: 'legacy_role_format' };
  }

  const mNs = raw.match(RE_LEGACY_NS);
  if (mNs) return { kind: 'legacy_namespace', ns: mNs[1].toLowerCase() };

  return { kind: 'invalid' };
}

export interface ScopeEvaluation {
  valid: boolean;
  /**
   * Стабильный enum для downstream-логики:
   *   - 'ok' (valid)
   *   - 'package_token_outside_package_context'  — pf/ln/package.* в billing scope
   *   - 'legacy_role_format'                     — устаревший role-формат
   *   - 'legacy_placeholder_format_detected'     — document./executor. и т.д. и любой invalid
   *   - 'unknown_modifier' | 'invalid_modifier_value'
   */
  reason?:
    | 'ok'
    | 'package_token_outside_package_context'
    | 'legacy_role_format'
    | 'legacy_placeholder_format_detected'
    | 'unknown_modifier'
    | 'invalid_modifier_value';
  classification: PlaceholderClassification;
}

/**
 * Возвращает (valid, reason, classification) для одного токена в указанном scope.
 *
 * Контекстный гейт работает ТОЛЬКО по синтаксису — фактическую проверку
 * "шаблон привязан к пакету через document_package_template_items" выполняет
 * вызывающий код (canonical-template-apply-markup / canonical-template-activate-version).
 */
export function evaluatePlaceholderInScope(
  inside: string,
  scope: PlaceholderScope,
): ScopeEvaluation {
  const c = classifyPlaceholder(inside);

  if (c.kind === 'unknown_modifier') {
    return { valid: false, reason: 'unknown_modifier', classification: c };
  }
  if (c.kind === 'invalid_modifier_value') {
    return { valid: false, reason: 'invalid_modifier_value', classification: c };
  }
  if (c.kind === 'legacy_role_format') {
    return { valid: false, reason: 'legacy_role_format', classification: c };
  }
  if (c.kind === 'legacy_namespace' || c.kind === 'invalid') {
    return { valid: false, reason: 'legacy_placeholder_format_detected', classification: c };
  }

  // c.kind ∈ {field, company_field, package_field, package_role, package_requisite}
  if (c.kind === 'field' || c.kind === 'company_field') {
    return { valid: true, reason: 'ok', classification: c };
  }

  // package-aware токены (pf, ln, package.*)
  if (scope === 'billing') {
    return { valid: false, reason: 'package_token_outside_package_context', classification: c };
  }

  // scope === 'package' | 'unknown' — синтаксически валидны.
  return { valid: true, reason: 'ok', classification: c };
}

/** Удобный список public_id всех package_field токенов в тексте шаблона. */
export function extractPackageFieldTokens(text: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = classifyPlaceholder(m[1]);
    if (c.kind === 'package_field') out.add(c.public_id);
  }
  return Array.from(out);
}
