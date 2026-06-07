/**
 * Phase 7-EXEC — Canonical Currency × Provider Resolver (shared, edge).
 *
 * Единственный источник истины для вопроса:
 *   «какие payment provider доступны для валюты X на акквайринговом аккаунте Y
 *    для payment_type Z».
 *
 * Контракт зафиксирован в:
 *   .lovable/discovery/phase_7_currency_provider_resolver_v1.md
 *   .lovable/proofs/phase_7_currency_provider_resolver_v1.md
 *
 * Правила:
 *  - НЕТ silent fallback на BYN/EUR.
 *  - НЕТ автоматической смены валюты.
 *  - bePaid в Phase 7-EXEC поддерживает ТОЛЬКО BYN (до отдельного discovery).
 *  - Stripe требует: business whitelist ∩ account capability snapshot.
 *  - Installment (finite subscription) запрещён для Stripe в этом MVP.
 *  - Backend — source of truth. Frontend mirror только для UX подсказок.
 */

export type PaymentProvider = 'bepaid' | 'stripe';

export type CurrencyProviderReasonCode =
  | 'currency_not_supported_by_provider'
  | 'currency_not_supported_by_account'
  | 'currency_not_allowed_by_business'
  | 'provider_not_configured'
  | 'provider_disabled'
  | 'missing_shop_id'
  | 'missing_account_code'
  | 'subscription_not_supported'
  | 'installment_not_supported';

export type DisabledProvider = {
  provider: PaymentProvider;
  reason_code: CurrencyProviderReasonCode;
  message: string;
  source:
    | 'provider_static'
    | 'stripe_account_capabilities'
    | 'business_whitelist'
    | 'acquiring_connections'
    | 'product_rules';
};

export type ResolveAvailableProvidersInput = {
  currency: string;
  payment_type: 'one_time' | 'subscription';
  /**
   * Кандидаты на проверку. Если не задано — проверяются оба провайдера.
   * Используется, например, для customer_choice = [bepaid, stripe].
   */
  candidate_providers?: PaymentProvider[];
  /**
   * Stripe account capability snapshot:
   * acquiring_connections.capabilities_snapshot.supported_currencies (lowercase ISO codes).
   * null / [] = «нет данных», capability check пропускается (R1 fallback).
   */
  stripe_account_supported_currencies?: string[] | null;
  /**
   * Подтверждение, что у нас есть резолвенный account_code для Stripe.
   * Если false — Stripe помечается как provider_disabled / missing_account_code.
   */
  stripe_account_resolved?: boolean;
  /**
   * Подтверждение, что у нас есть shop_id для bePaid.
   * Если false — bePaid помечается как missing_shop_id.
   * По умолчанию true (текущая инфра bePaid всегда доступна).
   */
  bepaid_shop_resolved?: boolean;
  /** Installment (finite subscription) — Stripe blocked. */
  is_installment?: boolean;
};

export type ResolveAvailableProvidersResult = {
  availableProviders: PaymentProvider[];
  disabledProviders: DisabledProvider[];
  warnings: string[];
};

/**
 * §4 — Business whitelist (Phase 7-EXEC).
 * RUB/KZT/UAH специально НЕ включены до отдельного approve (см. plan §4 / §12).
 */
export const BUSINESS_ALLOWED_CURRENCIES: ReadonlySet<string> = new Set([
  'BYN',
  'EUR',
  'USD',
  'PLN',
]);

/**
 * §5 — bePaid currency support (Phase 7-EXEC).
 * До отдельного discovery считаем, что bePaid доступен только для BYN.
 */
export function bepaidSupports(currency: string): boolean {
  return currency.toUpperCase() === 'BYN';
}

/**
 * §6 — Stripe currency support = business whitelist ∩ account capabilities.
 */
export function stripeSupports(
  currency: string,
  accountSupported: string[] | null | undefined,
): { allowed: boolean; reason?: CurrencyProviderReasonCode } {
  const upper = currency.toUpperCase();
  if (!BUSINESS_ALLOWED_CURRENCIES.has(upper)) {
    return { allowed: false, reason: 'currency_not_allowed_by_business' };
  }
  // Если snapshot пустой/нет — R1 fallback: пропускаем capability check,
  // полагаемся на business whitelist (отдельная audit-warning в caller).
  if (Array.isArray(accountSupported) && accountSupported.length > 0) {
    const set = new Set(accountSupported.map((c) => String(c).toLowerCase()));
    if (!set.has(upper.toLowerCase())) {
      return { allowed: false, reason: 'currency_not_supported_by_account' };
    }
  }
  return { allowed: true };
}

function messageFor(code: CurrencyProviderReasonCode, provider: PaymentProvider, currency: string): string {
  switch (code) {
    case 'currency_not_supported_by_provider':
      return provider === 'bepaid'
        ? `bePaid сейчас доступен только для BYN (получено ${currency}).`
        : `Провайдер не поддерживает валюту ${currency}.`;
    case 'currency_not_supported_by_account':
      return `Подключённый аккаунт Stripe не поддерживает валюту ${currency}.`;
    case 'currency_not_allowed_by_business':
      return `Валюта ${currency} не входит в бизнес-whitelist (BYN/EUR/USD/PLN).`;
    case 'provider_not_configured':
      return `Провайдер ${provider} не подключён.`;
    case 'provider_disabled':
      return `Провайдер ${provider} временно отключён.`;
    case 'missing_shop_id':
      return `Не найден shop_id bePaid.`;
    case 'missing_account_code':
      return `Не найден активный Stripe account_code.`;
    case 'subscription_not_supported':
      return `Подписка не поддерживается этим провайдером.`;
    case 'installment_not_supported':
      return `Рассрочка через Stripe не поддерживается.`;
  }
}

function sourceFor(code: CurrencyProviderReasonCode): DisabledProvider['source'] {
  switch (code) {
    case 'currency_not_supported_by_provider':
      return 'provider_static';
    case 'currency_not_supported_by_account':
      return 'stripe_account_capabilities';
    case 'currency_not_allowed_by_business':
      return 'business_whitelist';
    case 'provider_not_configured':
    case 'provider_disabled':
    case 'missing_shop_id':
    case 'missing_account_code':
      return 'acquiring_connections';
    case 'subscription_not_supported':
    case 'installment_not_supported':
      return 'product_rules';
  }
}

export function resolveAvailableProviders(
  input: ResolveAvailableProvidersInput,
): ResolveAvailableProvidersResult {
  const currency = (input.currency ?? '').toUpperCase();
  const candidates: PaymentProvider[] =
    input.candidate_providers && input.candidate_providers.length > 0
      ? Array.from(new Set(input.candidate_providers))
      : ['bepaid', 'stripe'];

  const available: PaymentProvider[] = [];
  const disabled: DisabledProvider[] = [];
  const warnings: string[] = [];

  for (const provider of candidates) {
    const block = (code: CurrencyProviderReasonCode) => {
      disabled.push({
        provider,
        reason_code: code,
        message: messageFor(code, provider, currency),
        source: sourceFor(code),
      });
    };

    if (provider === 'bepaid') {
      if (input.bepaid_shop_resolved === false) {
        block('missing_shop_id');
        continue;
      }
      if (!bepaidSupports(currency)) {
        block('currency_not_supported_by_provider');
        continue;
      }
      available.push('bepaid');
      continue;
    }

    if (provider === 'stripe') {
      if (input.is_installment) {
        block('installment_not_supported');
        continue;
      }
      if (input.stripe_account_resolved === false) {
        block('missing_account_code');
        continue;
      }
      const r = stripeSupports(currency, input.stripe_account_supported_currencies ?? null);
      if (!r.allowed) {
        block(r.reason!);
        continue;
      }
      if (
        !input.stripe_account_supported_currencies ||
        input.stripe_account_supported_currencies.length === 0
      ) {
        warnings.push(
          `stripe_capability_snapshot_missing:${currency} — relying on business whitelist (R1 fallback).`,
        );
      }
      available.push('stripe');
      continue;
    }
  }

  return { availableProviders: available, disabledProviders: disabled, warnings };
}
