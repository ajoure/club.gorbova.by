export interface ReferralCheckoutDiscount {
  baseAmountMinor: number;
  finalAmountMinor: number;
  discountBps: number;
  applied: boolean;
  ruleMode: 'inherit' | 'custom' | 'disabled' | null;
}

const unchanged = (amount: number): ReferralCheckoutDiscount => ({
  baseAmountMinor: amount,
  finalAmountMinor: amount,
  discountBps: 0,
  applied: false,
  ruleMode: null,
});

export function applyReferralDiscount(amountMinor: number, discountBps: number): number {
  return Math.max(Math.min(100, amountMinor), Math.round(amountMinor * (10_000 - discountBps) / 10_000));
}

/** Resolve the invited customer's price before any acquiring provider is called. */
export async function resolveReferralCheckoutDiscount(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  productId: string;
  amountMinor: number;
  allowImmediateDiscount?: boolean;
}): Promise<ReferralCheckoutDiscount> {
  const { supabase, userId, productId } = params;
  const amountMinor = Math.round(Number(params.amountMinor));
  if (!userId || !productId || !Number.isFinite(amountMinor) || amountMinor <= 0) return unchanged(amountMinor);
  if (params.allowImmediateDiscount === false) return unchanged(amountMinor);

  const [settingsResult, productResult, profileResult] = await Promise.all([
    supabase.from('referral_program_settings')
      .select('is_enabled,tracking_enabled,customer_discount_percent_bps')
      .eq('singleton', true).maybeSingle(),
    supabase.from('products_v2')
      .select('referral_settings_mode,referral_customer_discount_percent_bps')
      .eq('id', productId).maybeSingle(),
    supabase.from('profiles').select('id').eq('user_id', userId).maybeSingle(),
  ]);
  if (settingsResult.error || productResult.error || profileResult.error) {
    throw new Error('referral_discount_context_lookup_failed');
  }
  const settings = settingsResult.data;
  const product = productResult.data;
  const profileId = profileResult.data?.id;
  if (!settings?.is_enabled || !settings?.tracking_enabled || !product || !profileId) return unchanged(amountMinor);

  const mode = (product.referral_settings_mode || 'inherit') as 'inherit' | 'custom' | 'disabled';
  if (mode === 'disabled') return { ...unchanged(amountMinor), ruleMode: mode };

  const { data: relationship, error: relationshipError } = await supabase
    .from('referral_relationships').select('id')
    .eq('referred_profile_id', profileId).eq('status', 'active').maybeSingle();
  if (relationshipError) throw new Error('referral_relationship_lookup_failed');
  if (!relationship) return { ...unchanged(amountMinor), ruleMode: mode };

  const discountBps = Math.max(0, Math.min(10_000, Number(
    mode === 'custom'
      ? product.referral_customer_discount_percent_bps ?? settings.customer_discount_percent_bps
      : settings.customer_discount_percent_bps,
  ) || 0));
  if (discountBps <= 0) return { ...unchanged(amountMinor), ruleMode: mode };
  return {
    baseAmountMinor: amountMinor,
    finalAmountMinor: applyReferralDiscount(amountMinor, discountBps),
    discountBps,
    applied: true,
    ruleMode: mode,
  };
}

export function referralDiscountMeta(quote: ReferralCheckoutDiscount) {
  return quote.applied ? {
    referral_discount_applied: true,
    referral_discount_percent_bps: quote.discountBps,
    referral_discount_rule: quote.ruleMode,
    referral_base_amount_minor: quote.baseAmountMinor,
    referral_final_amount_minor: quote.finalAmountMinor,
  } : {};
}
