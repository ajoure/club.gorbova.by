import { checkZg27NewSale, ZG27_ACCESS_END_EXCLUSIVE, ZG27_PRODUCT_ID, ZG27_TIERS, type Zg27Category } from './zg27-policy.ts';

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

/** Invoice service dates describe the approved access cap, never a training start. */
export type Zg27InvoiceAccessContext = {
  policy_version: 'zg27-v1';
  access_end_exclusive: string;
  service_period_from: null;
  service_period_to: string;
};

export function zg27InvoiceDocumentPeriod(raw: unknown): Zg27InvoiceAccessContext {
  const context = raw as Partial<Zg27InvoiceAccessContext> | null;
  // The last included Minsk calendar day precedes the exclusive midnight.
  const lastDay = new Date(Date.parse(ZG27_ACCESS_END_EXCLUSIVE) + 3 * 3600000 - 1).toISOString().slice(0, 10);
  if (!context || context.policy_version !== 'zg27-v1'
    || context.access_end_exclusive !== ZG27_ACCESS_END_EXCLUSIVE
    || context.service_period_from !== null || context.service_period_to !== lastDay) {
    throw new Zg27CheckoutError('zg27_invoice_access_context_invalid');
  }
  return { policy_version: 'zg27-v1', access_end_exclusive: ZG27_ACCESS_END_EXCLUSIVE,
    service_period_from: null, service_period_to: lastDay };
}

export type Zg27CheckoutQuote = { applicable: false } | {
  applicable: true; category: 'first' | 'repeat'; totalMinor: number; amounts: number[];
  accessEndExclusive: string; pageSlug: string; policyVersion: 'zg27-v1';
  invoiceAccess?: Zg27InvoiceAccessContext;
};

/** Additional server gate for NEW sales. Existing verified debt repayment uses its own owned-row resolver. */
export async function assertZg27Checkout(input: {
  db: Db; userId: string | null | undefined; productId: string; tariffId: string | null | undefined;
  offerId: string | null | undefined; amountMinor?: number; amountKind?: 'total' | 'first_payment';
  currency?: string; installmentCount?: number; pageSlug?: string; now?: Date;
  /** Trusted admin-invoice caller only; never forwarded from a public request. */
  allowAdminInvoice?: boolean;
}): Promise<Zg27CheckoutQuote> {
  const { db } = input;
  const knownTariff = [ZG27_TIERS.first.tariffId, ZG27_TIERS.repeat.tariffId].includes(input.tariffId as any);
  if (!input.offerId) {
    if (input.productId === ZG27_PRODUCT_ID || knownTariff) throw new Zg27CheckoutError('zg27_offer_required');
    return { applicable: false };
  }
  const { data: offer, error: offerError } = await db.from('tariff_offers')
    .select('id,tariff_id,amount,is_active,offer_type,payment_method,installment_count,tariffs!inner(id,product_id,is_active,products_v2!inner(id,is_active,status))')
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
  const isInvoice = offer.offer_type === 'invoice';
  if (isInvoice && input.allowAdminInvoice !== true) throw new Zg27CheckoutError('zg27_invoice_unavailable', 409);
  // Generic invoices use bank_transfer, not full_payment. Only the approved
  // single full-price invoice is admitted; invoice installments remain closed.
  if (isInvoice && (offer.payment_method !== 'bank_transfer' || offer.installment_count !== 1)) {
    throw new Zg27CheckoutError('zg27_invoice_full_payment_required');
  }
  const isInstallment = offer.payment_method === 'internal_installment';
  const count = isInstallment ? Number(offer.installment_count) : 1;
  if (!isInvoice && !isInstallment && offer.payment_method !== 'full_payment') throw new Zg27CheckoutError('zg27_payment_method_unsupported');
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
    accessEndExclusive: check.accessEndExclusive, pageSlug, policyVersion: 'zg27-v1',
    ...(isInvoice ? { invoiceAccess: zg27InvoiceDocumentPeriod({ policy_version: 'zg27-v1',
      access_end_exclusive: check.accessEndExclusive, service_period_from: null,
      service_period_to: new Date(Date.parse(check.accessEndExclusive) + 3 * 3600000 - 1).toISOString().slice(0, 10) }) } : {}) };
}
