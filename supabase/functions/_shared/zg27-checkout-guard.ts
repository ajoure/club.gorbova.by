import { checkZg27NewSale, ZG27_PRODUCT_ID, ZG27_TIERS, type Zg27Category } from './zg27-policy.ts';

type Db = { from: (name: string) => any; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<any>; auth?: { getUser: (token: string) => Promise<any> } };
export class Zg27CheckoutError extends Error {
  code: string;
  status: number;
  pageSlug?: string;
  constructor(code: string, status = 403, pageSlug?: string) {
    super(code); this.name = 'Zg27CheckoutError'; this.code = code; this.status = status; this.pageSlug = pageSlug;
  }
}

/** Public ZG27 new-sale callers must verify the recipient, not accept a supplied email/UUID as login. */
export async function requireZg27Recipient(req: Request, db: Db, recipientUserId: string | null | undefined): Promise<void> {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match || !recipientUserId || !db.auth) throw new Zg27CheckoutError('zg27_login_required', 401);
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data?.user?.id) throw new Zg27CheckoutError('zg27_login_required', 401);
  if (data.user.id !== recipientUserId) throw new Zg27CheckoutError('zg27_recipient_mismatch', 403);
}

export type Zg27CheckoutQuote = { applicable: false } | {
  applicable: true; category: 'first' | 'repeat'; totalMinor: number; amounts: number[];
  accessEndExclusive: string; pageSlug: string; policyVersion: 'zg27-v1';
};

/** Additional server gate for NEW sales. Existing verified debt repayment uses its own owned-row resolver. */
export async function assertZg27Checkout(input: {
  db: Db; userId: string | null | undefined; productId: string; tariffId: string | null | undefined;
  offerId: string | null | undefined; amountMinor?: number; amountKind?: 'total' | 'first_payment';
  currency?: string; installmentCount?: number; pageSlug?: string; now?: Date;
}): Promise<Zg27CheckoutQuote> {
  const { db } = input;
  const knownTariff = [ZG27_TIERS.first.tariffId, ZG27_TIERS.repeat.tariffId].includes(input.tariffId as any);
  if (!input.offerId) {
    if (input.productId === ZG27_PRODUCT_ID || knownTariff) throw new Zg27CheckoutError('zg27_offer_required');
    return { applicable: false };
  }
  const { data: offer, error: offerError } = await db.from('tariff_offers')
    .select('id,tariff_id,amount,is_active,payment_method,installment_count,tariffs!inner(id,product_id,is_active,products_v2!inner(id,is_active,status))')
    .eq('id', input.offerId).maybeSingle();
  if (offerError) throw new Zg27CheckoutError('offer_eligibility_unavailable', 503);
  const tariff = offer?.tariffs && !Array.isArray(offer.tariffs) ? offer.tariffs : null;
  const applicable = input.productId === ZG27_PRODUCT_ID || knownTariff || tariff?.product_id === ZG27_PRODUCT_ID;
  if (!applicable) return { applicable: false };
  if (!offer || !tariff || offer.id !== input.offerId || tariff.id !== offer.tariff_id) throw new Zg27CheckoutError('zg27_offer_invalid');
  if (tariff.is_active !== true || tariff.products_v2?.id !== tariff.product_id
    || tariff.products_v2?.is_active !== true || tariff.products_v2?.status !== 'active') throw new Zg27CheckoutError('zg27_offer_inactive');
  if (!input.userId) throw new Zg27CheckoutError('zg27_login_required', 401);
  const { data: eligibility, error } = await db.rpc('zg27_purchase_eligibility_v1', {
    p_user_id: input.userId, p_product_id: ZG27_PRODUCT_ID,
  });
  if (error || !eligibility || eligibility.policy_version !== 'zg27-v1'
    || !['first','repeat','not_eligible'].includes(eligibility.category)
    || eligibility.eligible !== (eligibility.category === 'first' || eligibility.category === 'repeat')) {
    throw new Zg27CheckoutError('zg27_eligibility_unavailable', 503);
  }
  if (!eligibility.eligible) throw new Zg27CheckoutError('zg27_not_eligible');
  const isInstallment = offer.payment_method === 'internal_installment';
  const count = isInstallment ? Number(offer.installment_count) : 1;
  if (!isInstallment && offer.payment_method !== 'full_payment') throw new Zg27CheckoutError('zg27_payment_method_unsupported');
  if (input.installmentCount !== undefined && input.installmentCount !== count) throw new Zg27CheckoutError('zg27_installment_count_mismatch');
  const check = checkZg27NewSale({ productId: input.productId, tariffId: input.tariffId ?? null,
    offerProductId: tariff.product_id, offerTariffId: offer.tariff_id, offerActive: offer.is_active === true,
    offerAmount: Number(offer.amount), installmentCount: count, currency: input.currency ?? 'BYN',
    category: eligibility.category as Zg27Category, now: input.now ?? new Date() });
  if (check.applicable === false) throw new Zg27CheckoutError('zg27_offer_invalid');
  if (check.allowed === false) throw new Zg27CheckoutError(check.reason, 403, check.page);
  const pageSlug = ZG27_TIERS[check.tier].page;
  if (input.pageSlug !== undefined && input.pageSlug !== pageSlug) throw new Zg27CheckoutError('zg27_wrong_page', 403, pageSlug);
  const expectedAmount = input.amountKind === 'first_payment' ? Math.round(check.amounts[0] * 100) : check.totalMinor;
  if (input.amountMinor !== undefined && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor !== expectedAmount)) {
    throw new Zg27CheckoutError('zg27_checkout_amount_mismatch');
  }
  return { applicable: true, category: check.tier, totalMinor: check.totalMinor, amounts: check.amounts,
    accessEndExclusive: check.accessEndExclusive, pageSlug, policyVersion: 'zg27-v1' };
}
