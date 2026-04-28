/**
 * Shared resolver: determines whether a product is "renewable" based on its
 * active tariff_offers — NOT the user's current subscription state.
 *
 * Sources of truth (priority):
 *   1. tariff_offers.meta.recurring.is_recurring === true
 *   2. tariff_offers.payment_method === 'internal_installment'  (рассрочка)
 *   3. tariff_offers.is_installment === true
 *   4. tariff_offers.offer_type === 'subscription'
 *
 * If ANY active offer for the product matches → product is renewable.
 * If product has no active offers → conservative `renewable=false` + reason.
 *
 * Used by: subscription-renewal-reminders, telegram-send-reminders,
 *          generate-renewal-ctas (gating), AdminPaymentLinkDialog (telegram body).
 */

export type RenewalKind = 'recurring' | 'installment' | 'subscription_offer' | 'one_time';

export interface RenewableOffer {
  id: string;
  tariff_id: string;
  offer_type: string;
  payment_method: string | null;
  amount: number;
  is_installment: boolean;
  installment_count: number | null;
  is_recurring: boolean;
  kind: RenewalKind;
  is_primary: boolean;
}

export interface ProductRenewability {
  productId: string;
  renewable: boolean;
  hasRecurring: boolean;
  hasInstallment: boolean;
  hasSubscriptionOffer: boolean;
  preferredTariffId: string | null;
  preferredOffer: RenewableOffer | null;
  offers: RenewableOffer[];
  reason: string;
}

function classifyOffer(o: any): RenewableOffer {
  const meta = (o.meta ?? {}) as any;
  const isRecurring = !!meta?.recurring?.is_recurring;
  const paymentMethod: string | null = o.payment_method ?? null;
  const isInstallment = !!o.is_installment || paymentMethod === 'internal_installment';
  const isSubscriptionOffer = o.offer_type === 'subscription';

  let kind: RenewalKind = 'one_time';
  if (isRecurring) kind = 'recurring';
  else if (isInstallment) kind = 'installment';
  else if (isSubscriptionOffer) kind = 'subscription_offer';

  return {
    id: o.id,
    tariff_id: o.tariff_id,
    offer_type: o.offer_type,
    payment_method: paymentMethod,
    amount: Number(o.amount ?? 0),
    is_installment: isInstallment,
    installment_count: o.installment_count ?? null,
    is_recurring: isRecurring,
    kind,
    is_primary: !!o.is_primary,
  };
}

/**
 * Resolve renewability for a product (by product_id).
 * If `preferredTariffId` is given and matches one of the renewable offers, it wins.
 */
export async function resolveProductRenewability(
  supabase: any,
  productId: string,
  preferredTariffId?: string | null,
): Promise<ProductRenewability> {
  const empty: ProductRenewability = {
    productId,
    renewable: false,
    hasRecurring: false,
    hasInstallment: false,
    hasSubscriptionOffer: false,
    preferredTariffId: null,
    preferredOffer: null,
    offers: [],
    reason: 'no_active_offers',
  };

  // Fetch active tariffs of the product
  const { data: tariffs, error: tariffsErr } = await supabase
    .from('tariffs')
    .select('id, is_active')
    .eq('product_id', productId)
    .eq('is_active', true);
  if (tariffsErr || !tariffs || tariffs.length === 0) {
    return { ...empty, reason: tariffsErr ? `tariffs_error:${tariffsErr.message}` : 'no_active_tariffs' };
  }
  const tariffIds = tariffs.map((t: any) => t.id);

  const nowIso = new Date().toISOString();

  // Fetch active offers, visible now
  const { data: rawOffers, error: offersErr } = await supabase
    .from('tariff_offers')
    .select('id, tariff_id, offer_type, payment_method, amount, is_installment, installment_count, is_active, is_primary, visible_from, visible_to, meta')
    .in('tariff_id', tariffIds)
    .eq('is_active', true);
  if (offersErr) {
    return { ...empty, reason: `offers_error:${offersErr.message}` };
  }
  const offers: RenewableOffer[] = (rawOffers ?? [])
    .filter((o: any) => {
      if (o.visible_from && o.visible_from > nowIso) return false;
      if (o.visible_to && o.visible_to < nowIso) return false;
      return true;
    })
    .map(classifyOffer);

  if (offers.length === 0) {
    return { ...empty, reason: 'no_visible_offers' };
  }

  const renewableOffers = offers.filter((o) => o.kind !== 'one_time');
  const hasRecurring = renewableOffers.some((o) => o.kind === 'recurring');
  const hasInstallment = renewableOffers.some((o) => o.kind === 'installment');
  const hasSubscriptionOffer = renewableOffers.some((o) => o.kind === 'subscription_offer');
  const renewable = renewableOffers.length > 0;

  // Pick preferred offer:
  //   1) match preferredTariffId if it has any renewable offer
  //   2) else: primary recurring offer
  //   3) else: any recurring
  //   4) else: installment
  //   5) else: subscription_offer
  let preferredOffer: RenewableOffer | null = null;
  if (preferredTariffId) {
    preferredOffer =
      renewableOffers.find((o) => o.tariff_id === preferredTariffId && o.is_primary) ??
      renewableOffers.find((o) => o.tariff_id === preferredTariffId) ??
      null;
  }
  if (!preferredOffer) {
    preferredOffer =
      renewableOffers.find((o) => o.kind === 'recurring' && o.is_primary) ??
      renewableOffers.find((o) => o.kind === 'recurring') ??
      renewableOffers.find((o) => o.kind === 'installment') ??
      renewableOffers.find((o) => o.kind === 'subscription_offer') ??
      null;
  }

  return {
    productId,
    renewable,
    hasRecurring,
    hasInstallment,
    hasSubscriptionOffer,
    preferredTariffId: preferredOffer?.tariff_id ?? null,
    preferredOffer,
    offers,
    reason: renewable ? 'ok' : 'only_one_time_offers',
  };
}

/**
 * Convenience: Build a human-readable label for a renewable offer.
 */
export function buildOfferLabel(o: RenewableOffer): string {
  if (o.kind === 'installment') {
    const n = o.installment_count ?? 0;
    return n > 0 ? `Рассрочка · ${n} платеж${n === 1 ? '' : n < 5 ? 'а' : 'ей'}` : 'Рассрочка';
  }
  if (o.kind === 'recurring' || o.kind === 'subscription_offer') {
    return 'Подписка с автопродлением';
  }
  return 'Разовая оплата';
}
