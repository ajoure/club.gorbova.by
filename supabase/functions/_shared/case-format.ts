// ============================================================================
// case-format.ts — модификатор |case=... для legacy DOCX-плейсхолдеров
// ----------------------------------------------------------------------------
// Применяется в supabase/functions/_shared/document-render.ts для токенов
// customer.name | payer.name | executor.name | executor.short_name |
// executor.director. Все остальные токены отдают исходное значение и warning
// case_modifier_not_applied:<token>:unsupported_field.
//
// Безопасность: при любом fail инфлектора возвращаем исходное значение и
// помечаем warning — документ никогда не падает из-за модификатора.
// ============================================================================

import {
  inflectRu,
  inflectCompanyName,
  type RuCase,
} from './ru-inflection.ts';

export const ALLOWED_CASES: ReadonlyArray<RuCase> = [
  'nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional',
];

export function isCaseModifier(value: string): value is RuCase {
  return (ALLOWED_CASES as ReadonlyArray<string>).includes(value);
}

export type FieldKind = 'person_name' | 'company_name' | 'unsupported';

export interface CaseContext {
  tokenKey: string;
  /** Берётся из payload.snapshot.customer_resolution.payer_type или customer.client_type */
  customerType?: 'individual' | 'legal_entity' | 'entrepreneur' | null;
}

export function classifyTokenForCase(ctx: CaseContext): FieldKind {
  const t = ctx.tokenKey;
  if (t === 'customer.name' || t === 'payer.name') {
    if (ctx.customerType === 'legal_entity') return 'company_name';
    if (ctx.customerType === 'entrepreneur') return 'company_name'; // ИП-префикс маршрутизируется в company; внутри inflectCompanyName хвост ФИО склоняется через inflectRu
    return 'person_name';
  }
  if (t === 'executor.name' || t === 'executor.short_name') return 'company_name';
  if (t === 'executor.director') return 'person_name';
  return 'unsupported';
}

export interface ApplyCaseResult {
  value: string;
  applied: boolean;
  warning?: string;
}

/**
 * applyCaseModifier — основной helper.
 * НЕ выдаёт warning при успешном применении (success == no warning).
 */
export function applyCaseModifier(
  value: string | null | undefined,
  caseModifier: string,
  ctx: CaseContext,
): ApplyCaseResult {
  const v = value == null ? '' : String(value);
  if (!isCaseModifier(caseModifier)) {
    return { value: v, applied: false, warning: `case_modifier_unknown:${caseModifier}` };
  }
  if (caseModifier === 'nominative') {
    return { value: v, applied: true };
  }
  if (!v.trim()) {
    return { value: v, applied: false, warning: `case_modifier_not_applied:${ctx.tokenKey}:empty_value` };
  }

  const kind = classifyTokenForCase(ctx);
  if (kind === 'unsupported') {
    return {
      value: v, applied: false,
      warning: `case_modifier_not_applied:${ctx.tokenKey}:unsupported_field`,
    };
  }

  try {
    if (kind === 'person_name') {
      const r = inflectRu(v, caseModifier);
      if (r.applied) return { value: r.value, applied: true };
      return {
        value: v, applied: false,
        warning: `case_modifier_not_applied:${ctx.tokenKey}:${r.reason || 'unknown'}`,
      };
    }
    // company_name
    const c = inflectCompanyName(v, caseModifier);
    if (c.applied) return { value: c.value, applied: true };

    // entrepreneur fallback: попробовать как person_name (ФИО без префикса)
    if (ctx.customerType === 'entrepreneur') {
      const r2 = inflectRu(v, caseModifier);
      if (r2.applied) return { value: r2.value, applied: true };
    }
    return {
      value: v, applied: false,
      warning: `case_modifier_not_applied:${ctx.tokenKey}:${c.reason || 'unknown'}`,
    };
  } catch (e: any) {
    return {
      value: v, applied: false,
      warning: `case_modifier_failed:${ctx.tokenKey}:${e?.message || 'exception'}`,
    };
  }
}
