/** Approved ZG27 commercial rules. Inputs must come from authenticated server reads. */
export const ZG27_PRODUCT_ID = 'e71c0dbb-baf2-4b6c-a950-bf0f728708af';
export const ZG27_ACCESS_END_EXCLUSIVE = '2027-04-30T21:00:00.000Z';
export const ZG27_INTERVAL_DAYS = 30;
export const ZG27_TIERS = {
  first: { tariffId: 'd0fce8c6-473a-49a1-978f-1069d0f012bc', totalMinor: 129000, page: 'zg27pervoe' },
  repeat: { tariffId: '08059eb1-748a-4ad6-8283-e6f1efa2f40f', totalMinor: 89000, page: 'zg27povtor' },
} as const;

export type HistoricalParticipation = 'confirmed' | 'absent' | 'unknown';
export type Zg27Category = 'first' | 'repeat' | 'not_eligible' | 'unavailable' | 'login_required';

/** An expired confirmed enrollment remains historical participation; completion is irrelevant. */
export function classifyZg27Participation(input: {
  authenticated: boolean;
  cb: HistoricalParticipation;
  previousZg: HistoricalParticipation;
}): Zg27Category {
  if (!input.authenticated) return 'login_required';
  if (input.cb === 'unknown') return 'unavailable';
  if (input.cb !== 'confirmed') return 'not_eligible';
  if (input.previousZg === 'unknown') return 'unavailable';
  return input.previousZg === 'confirmed' ? 'repeat' : 'first';
}

/** Exact approved kopeck schedule, with rounding remainder only in the last payment. */
export function zg27InstallmentAmounts(tier: 'first' | 'repeat', count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('zg27_installment_count_invalid');
  const totalMinor = ZG27_TIERS[tier].totalMinor;
  const regularMinor = Math.round(totalMinor / count);
  return Array.from({ length: count }, (_, i) =>
    (i === count - 1 ? totalMinor - regularMinor * (count - 1) : regularMinor) / 100);
}

export type Zg27OfferCheck =
  | { applicable: false }
  | { applicable: true; allowed: false; reason: string; page?: string }
  | { applicable: true; allowed: true; tier: 'first' | 'repeat'; totalMinor: number; amounts: number[]; accessEndExclusive: string };

/** Additional gate, never an auth replacement; validate before creating an order/provider intent. */
export function checkZg27NewSale(input: {
  productId: string;
  tariffId: string | null;
  offerProductId: string | null;
  offerTariffId: string | null;
  offerActive: boolean;
  offerAmount: number;
  installmentCount: number;
  currency: string;
  category: Zg27Category;
  now: Date;
}): Zg27OfferCheck {
  const zg27Tariffs: readonly string[] = [ZG27_TIERS.first.tariffId, ZG27_TIERS.repeat.tariffId];
  if (input.productId !== ZG27_PRODUCT_ID && input.offerProductId !== ZG27_PRODUCT_ID
    && !zg27Tariffs.includes(input.tariffId ?? '') && !zg27Tariffs.includes(input.offerTariffId ?? '')) return { applicable: false };
  const deny = (reason: string, page?: string): Zg27OfferCheck => ({ applicable: true, allowed: false, reason, ...(page ? { page } : {}) });
  if (input.productId !== ZG27_PRODUCT_ID || input.offerProductId !== ZG27_PRODUCT_ID || !input.offerActive) return deny('zg27_offer_invalid');
  if (!Number.isFinite(input.now.getTime()) || input.now.getTime() >= Date.parse(ZG27_ACCESS_END_EXCLUSIVE)) return deny('zg27_sale_closed');
  if (input.category !== 'first' && input.category !== 'repeat') return deny(`zg27_${input.category}`);
  const tier = ZG27_TIERS[input.category];
  if (input.tariffId !== tier.tariffId || input.offerTariffId !== tier.tariffId) return deny('zg27_wrong_participation', tier.page);
  if (input.currency !== 'BYN' || !Number.isFinite(input.offerAmount)
    || Math.abs(input.offerAmount * 100 - tier.totalMinor) > 0.000001) return deny('zg27_price_mismatch');
  if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1 || input.installmentCount > 3) return deny('zg27_installment_count_invalid');
  return { applicable: true, allowed: true, tier: input.category, totalMinor: tier.totalMinor,
    amounts: zg27InstallmentAmounts(input.category, input.installmentCount), accessEndExclusive: ZG27_ACCESS_END_EXCLUSIVE };
}
