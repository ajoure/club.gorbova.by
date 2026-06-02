// Phase 1 Stripe Integration — payment profile resolver
//
// Resolves a payment profile (currency, payment_method_types, mode, locale)
// for a checkout call. On MVP the inline profile lives in
// `tariff_offers.meta.stripe_profile` (or future `meta.<provider>_profile`).
// A dedicated `payment_provider_profiles` table appears in Phase 3 when 5+
// profiles exist.

import type { AcquiringProvider } from './types.ts';

export interface InlineProfile {
  code?: string;
  currency: string;
  payment_method_types: string[];
  mode: 'payment' | 'subscription' | 'setup';
  tax_behavior?: 'inclusive' | 'exclusive';
  locale?: string;
}

export interface ResolveProfileArgs {
  provider: AcquiringProvider;
  tariff_meta?: Record<string, unknown> | null;
  link_profile_code?: string | null;
  account_default_profile_code?: string | null;
}

const DEFAULT_INLINE_PROFILES: Record<string, InlineProfile> = {
  stripe_standard_eur: {
    code: 'stripe_standard_eur',
    currency: 'EUR',
    payment_method_types: ['card'],
    mode: 'payment',
    tax_behavior: 'inclusive',
    locale: 'auto',
  },
  stripe_standard_pln: {
    code: 'stripe_standard_pln',
    currency: 'PLN',
    payment_method_types: ['card'],
    mode: 'payment',
    tax_behavior: 'inclusive',
    locale: 'auto',
  },
  stripe_standard_usd: {
    code: 'stripe_standard_usd',
    currency: 'USD',
    payment_method_types: ['card'],
    mode: 'payment',
    tax_behavior: 'inclusive',
    locale: 'auto',
  },
  stripe_subscription_eur: {
    code: 'stripe_subscription_eur',
    currency: 'EUR',
    payment_method_types: ['card'],
    mode: 'subscription',
    tax_behavior: 'inclusive',
    locale: 'auto',
  },
};

export function resolveProfile(args: ResolveProfileArgs): InlineProfile | null {
  const inline = (args.tariff_meta?.[`${args.provider}_profile`] ?? null) as InlineProfile | null;
  if (inline && typeof inline === 'object') return inline;
  const code =
    args.link_profile_code ??
    (args.tariff_meta?.profile_code as string | undefined) ??
    args.account_default_profile_code ??
    null;
  if (code && DEFAULT_INLINE_PROFILES[code]) return DEFAULT_INLINE_PROFILES[code];
  return null;
}
