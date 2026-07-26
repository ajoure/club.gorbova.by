export interface ProviderSubscriptionOfferSnapshot {
  id?: string | null;
  tariff_id?: string | null;
  is_active?: boolean | null;
  payment_method?: string | null;
  is_installment?: boolean | null;
  installment_count?: number | null;
}

export type ProviderSubscriptionOfferGuard =
  | { ok: true }
  | {
      ok: false;
      code: 'INVALID_OFFER' | 'FINITE_INSTALLMENT_REQUIRES_INSTALLMENT_CHECKOUT';
      status: 400 | 409;
    };

/**
 * A finite installment is represented by bePaid as a bounded sbs_* plan, but
 * it must be created through the canonical installment-link checkout that
 * writes billing_cycles and infinite=false. The ordinary subscription writer
 * creates renewable plans and therefore must fail closed for installment
 * offers.
 */
export function guardProviderSubscriptionOffer(
  offer: ProviderSubscriptionOfferSnapshot | null,
  expectedTariffId: string,
): ProviderSubscriptionOfferGuard {
  if (
    !offer?.id ||
    offer.is_active !== true ||
    offer.tariff_id !== expectedTariffId
  ) {
    return { ok: false, code: 'INVALID_OFFER', status: 400 };
  }

  if (
    offer.payment_method === 'internal_installment' ||
    offer.is_installment === true ||
    Number(offer.installment_count ?? 0) >= 2
  ) {
    return {
      ok: false,
      code: 'FINITE_INSTALLMENT_REQUIRES_INSTALLMENT_CHECKOUT',
      status: 409,
    };
  }

  return { ok: true };
}
