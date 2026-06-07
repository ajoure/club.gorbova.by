/**
 * Phase 7-EXEC — Frontend mirror резолвера currency × provider.
 *
 * ⚠️ Не источник истины. Source of truth = edge helper
 *    supabase/functions/_shared/acquiring/currency-provider-resolver.ts.
 *
 * Используется только для UX подсказок в admin UI:
 *  - подсветить недоступные карточки provider в `AdminPaymentLinkDialog`;
 *  - показать tooltip с reason до отправки на backend;
 *  - предотвратить ложные комбинации до серверной валидации.
 *
 * Backend всё равно перепроверяет и блокирует несовместимые комбинации.
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
};

export type ResolveInput = {
  currency: string;
  payment_type: 'one_time' | 'subscription';
  candidate_providers?: PaymentProvider[];
  stripe_account_supported_currencies?: string[] | null;
  stripe_account_resolved?: boolean;
  bepaid_shop_resolved?: boolean;
  is_installment?: boolean;
};

export type ResolveResult = {
  availableProviders: PaymentProvider[];
  disabledProviders: DisabledProvider[];
  warnings: string[];
};

export const BUSINESS_ALLOWED_CURRENCIES: ReadonlySet<string> = new Set([
  'BYN',
  'EUR',
  'USD',
  'PLN',
]);

export function bepaidSupports(currency: string): boolean {
  return currency.toUpperCase() === 'BYN';
}

export function stripeSupports(
  currency: string,
  accountSupported: string[] | null | undefined,
): { allowed: boolean; reason?: CurrencyProviderReasonCode } {
  const upper = currency.toUpperCase();
  if (!BUSINESS_ALLOWED_CURRENCIES.has(upper)) {
    return { allowed: false, reason: 'currency_not_allowed_by_business' };
  }
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
        ? `Доступно только для BYN`
        : `Провайдер не поддерживает ${currency}`;
    case 'currency_not_supported_by_account':
      return `Аккаунт Stripe не поддерживает ${currency}`;
    case 'currency_not_allowed_by_business':
      return `Валюта ${currency} вне whitelist (BYN/EUR/USD/PLN)`;
    case 'provider_not_configured':
      return `Провайдер не подключён`;
    case 'provider_disabled':
      return `Провайдер отключён`;
    case 'missing_shop_id':
      return `Нет shop_id bePaid`;
    case 'missing_account_code':
      return `Нет активного Stripe account`;
    case 'subscription_not_supported':
      return `Подписка не поддерживается`;
    case 'installment_not_supported':
      return `Рассрочка через Stripe недоступна`;
  }
}

export function resolveAvailableProviders(input: ResolveInput): ResolveResult {
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
      disabled.push({ provider, reason_code: code, message: messageFor(code, provider, currency) });
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
        warnings.push(`stripe_capability_snapshot_missing:${currency}`);
      }
      available.push('stripe');
    }
  }

  return { availableProviders: available, disabledProviders: disabled, warnings };
}
