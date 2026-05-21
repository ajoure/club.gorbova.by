// ============================================================================
// standard-fields.ts — Sprint 11
// ----------------------------------------------------------------------------
// Build non-executor field values (customer.*, deal.*, order.*, system.*,
// product.*, tariff.*, offer.*, document.service_*) for the document_data
// snapshot. All FLDs written here are NEVER manual_override (snapshot is SOT,
// can be overridden later via canonical-deal-fields-update).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { formatMoney } from './docx-helpers.ts';
import { dotDate, dotDateTime, ruLongDate, ruWordsDate } from './ru-date.ts';
import { formatAmountWithWordsByRublesAndKopecks } from './amount-with-words.ts';

function fullNameToInitials(fullName?: string | null): string {
  if (!fullName) return '';
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

// Legacy callers may pass a date — render dd.MM.yyyy in Europe/Minsk.
function dateRu(d?: string | Date | null): string {
  return dotDate(d);
}

function isoDate(d?: string | Date | null): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function buildCustomerName(c: any): string {
  if (!c) return '';
  if (c.client_type === 'individual') return c.ind_full_name || '';
  if (c.client_type === 'entrepreneur') return c.ent_name || '';
  if (c.client_type === 'legal') {
    const parts = [c.leg_org_form, c.leg_name].filter(Boolean);
    return parts.join(' ').trim() || c.leg_name || '';
  }
  return c.ind_full_name || c.ent_name || c.leg_name || '';
}

function buildCustomerAddress(c: any): string {
  if (!c) return '';
  if (c.client_type === 'individual') {
    const parts = [
      c.ind_address_index, c.ind_address_region, c.ind_address_district,
      c.ind_address_city, c.ind_address_street, c.ind_address_house,
      c.ind_address_apartment ? `кв. ${c.ind_address_apartment}` : null,
    ].filter(Boolean);
    return parts.join(', ');
  }
  if (c.client_type === 'entrepreneur') return c.ent_address || '';
  if (c.client_type === 'legal') return c.leg_address || '';
  return '';
}

export interface StandardContext {
  order: any;
  product: any | null;
  tariff: any | null;
  offer: any | null;
  customer: any | null;  // client_legal_details
  documentData: any;     // computed document_data block (amount, currency, ...)
}

/**
 * Build full FLD-id → string value map for non-executor fields based on the
 * resolved context.
 */
export function buildStandardFieldValues(ctx: StandardContext): Record<string, string> {
  const { order, product, tariff, offer, customer, documentData } = ctx;
  const now = new Date();
  const paidAt: string = documentData?.source?.order_paid_at
    || (order as any)?.deal_date
    || (order as any)?.updated_at
    || order?.created_at
    || now.toISOString();
  const currency = (documentData?.currency || order?.currency || 'BYN') as string;
  const amount = documentData?.amount ?? order?.final_price ?? null;

  const pay = (documentData?.payment || null) as any | null;

  const v: Record<string, string> = {
    // ── system.* ───────────────────────────────────────────────
    'FLD-000133': dotDate(now),                                 // system.today        → 20.05.2026
    'FLD-000134': ruLongDate(now),                              // system.today_long   → 20 мая 2026 г.
    'FLD-000209': ruWordsDate(now),                             // system.today_ru     → 20 мая 2026 года
    'FLD-000210': dotDateTime(now),                             // system.now          → 20.05.2026 14:30
    'FLD-000211': String(now.getFullYear()),                    // system.year
    'FLD-000212': String(now.getMonth() + 1).padStart(2, '0'),  // system.month

    // ── customer.* ─────────────────────────────────────────────
    'FLD-000113': buildCustomerName(customer),                                                  // customer.name
    'FLD-000114': customer?.client_type === 'individual'
      ? fullNameToInitials(customer?.ind_full_name)
      : buildCustomerName(customer),                                                            // customer.short_name
    'FLD-000115': customer?.ent_unp || customer?.leg_unp || '',                                 // customer.unp
    'FLD-000116': buildCustomerAddress(customer),                                               // customer.address
    'FLD-000117': customer?.phone || order?.customer_phone || '',                               // customer.phone
    'FLD-000118': customer?.email || order?.customer_email || '',                               // customer.email
    'FLD-000119': customer?.bank_name || '',                                                    // customer.bank
    'FLD-000120': customer?.bank_account || '',                                                 // customer.account
    'FLD-000121': customer?.ind_passport_series && customer?.ind_passport_number
      ? `${customer.ind_passport_series} ${customer.ind_passport_number}` : '',                 // customer.passport
    'FLD-000141': customer?.client_type || '',                                                  // customer.client_type
    'FLD-000142': customer?.client_type === 'individual' ? '' : (customer?.ent_address || customer?.leg_address || ''), // customer.legal_address
    'FLD-000143': customer?.bank_name || '',                                                    // customer.bank_name
    'FLD-000144': customer?.bank_code || '',                                                    // customer.bank_code
    'FLD-000145': customer?.ind_personal_number || '',                                          // customer.personal_number
    'FLD-000213': customer?.leg_director_name || '',                                            // customer.director
    'FLD-000214': fullNameToInitials(customer?.leg_director_name),                              // customer.director_short
    'FLD-000215': customer?.leg_director_name || '',                                            // customer.director_full_name
    'FLD-000216': customer?.leg_director_position || '',                                        // customer.director_position
    'FLD-000217': customer?.leg_acts_on_basis || customer?.ent_acts_on_basis || '',             // customer.acts_on_basis
    'FLD-000218': customer?.leg_acts_on_basis || customer?.ent_acts_on_basis || '',             // customer.basis

    // ── deal.* / order.* (FLDs use entity_type='deal') ─────────
    'FLD-000122': order?.id || '',                                                              // deal.id
    'FLD-000123': product?.name || '',                                                          // deal.product_name
    'FLD-000124': tariff?.name || '',                                                           // deal.tariff_name
    'FLD-000125': amount != null ? String(amount) : '',                                         // deal.amount
    'FLD-000126': amount != null ? formatAmountWithWordsByRublesAndKopecks(Number(amount), currency) : '', // deal.amount_words
    'FLD-000127': currency,                                                                     // deal.currency
    'FLD-000128': dateRu(paidAt),                                                               // deal.paid_at
    'FLD-000129': tariff?.access_days != null ? String(tariff.access_days) : '',                // deal.access_days

    'FLD-000155': order?.id || '',                                                              // order.id
    'FLD-000156': order?.order_number || '',                                                    // order.number
    'FLD-000157': order?.status || '',                                                          // order.status
    'FLD-000158': isoDate(order?.created_at),                                                   // order.created_at
    'FLD-000159': isoDate(paidAt),                                                              // order.paid_at
    'FLD-000160': amount != null ? String(amount) : '',                                         // order.amount
    'FLD-000161': currency,                                                                     // order.currency
    'FLD-000162': order?.customer_email || '',                                                  // order.customer_email
    'FLD-000163': order?.customer_phone || '',                                                  // order.customer_phone
    'FLD-000164': (order?.meta as any)?.payment_method || (order?.meta as any)?.payment_provider || '', // order.payment_method

    // ── product.* ─────────────────────────────────────────────
    'FLD-000165': product?.id || '',                                                            // product.id
    'FLD-000166': product?.name || '',                                                          // product.name
    'FLD-000167': product?.slug || product?.code || '',                                         // product.code
    'FLD-000168': product?.description || '',                                                   // product.description

    // ── tariff.* ──────────────────────────────────────────────
    'FLD-000169': tariff?.id || '',                                                             // tariff.id
    'FLD-000170': tariff?.name || '',                                                           // tariff.name
    'FLD-000171': tariff?.price != null ? String(tariff.price) : '',                            // tariff.price
    'FLD-000172': tariff?.currency || currency,                                                 // tariff.currency
    'FLD-000173': tariff?.access_days != null ? String(tariff.access_days) : '',                // tariff.access_days
    'FLD-000174': tariff?.description || '',                                                    // tariff.description

    // ── offer.* ───────────────────────────────────────────────
    'FLD-000175': offer?.id || '',                                                              // offer.id
    'FLD-000176': offer?.title || offer?.name || '',                                            // offer.name
    'FLD-000177': offer?.offer_type || offer?.type || '',                                       // offer.type
    'FLD-000178': offer?.amount != null ? String(offer.amount) : (amount != null ? String(amount) : ''), // offer.amount
    'FLD-000179': offer?.currency || currency,                                                  // offer.currency
    'FLD-000180': (offer?.meta as any)?.reentry_price != null ? String((offer?.meta as any).reentry_price) : '', // offer.reentry_price
    'FLD-000181': (offer?.meta as any)?.recurring?.is_recurring === true ? 'true' : 'false',    // offer.is_subscription

    // ── document.service_* / document.* (from documentData snapshot) ──
    'FLD-000186': documentData?.service_name || product?.name || '',                            // document.service_name
    'FLD-000187': documentData?.service_description || tariff?.description || product?.description || '', // document.service_description
    'FLD-000188': documentData?.unit || 'услуга',                                               // document.service_unit
    'FLD-000189': documentData?.quantity != null ? String(documentData.quantity) : '1',         // document.service_quantity
    'FLD-000190': documentData?.unit_price != null ? String(documentData.unit_price) : (amount != null ? String(amount) : ''), // document.service_price
    'FLD-000191': amount != null ? String(amount) : '',                                         // document.service_amount
    'FLD-000192': documentData?.amount_words || (amount != null ? formatAmountWithWordsByRublesAndKopecks(Number(amount), currency) : ''), // document.amount_words
    'FLD-000193': documentData?.currency_major || '',                                           // document.currency_major
    'FLD-000194': documentData?.currency_minor || '',                                           // document.currency_minor
    'FLD-000195': documentData?.payment_due_days != null ? String(documentData.payment_due_days) : '', // document.payment_due_days
    'FLD-000196': documentData?.execution_days != null ? String(documentData.execution_days) : '',     // document.execution_days
    'FLD-000197': documentData?.service_period_from || '',                                      // document.service_period_from
    'FLD-000198': documentData?.service_period_to || '',                                        // document.service_period_to
    'FLD-000199': documentData?.months_count != null ? String(documentData.months_count) : '',  // document.months_count
    'FLD-000200': documentData?.prepayment_percent != null ? String(documentData.prepayment_percent) : '', // document.prepayment_percent
    'FLD-000201': documentData?.prepayment_amount != null ? String(documentData.prepayment_amount) : '', // document.prepayment_amount
    'FLD-000202': documentData?.discount_amount != null ? String(documentData.discount_amount) : '',     // document.discount_amount
    'FLD-000203': documentData?.first_payment != null ? String(documentData.first_payment) : '',         // document.first_payment
    'FLD-000204': documentData?.bank_credit_price != null ? String(documentData.bank_credit_price) : '', // document.bank_credit_price
    'FLD-000205': documentData?.final_payment != null ? String(documentData.final_payment) : '',         // document.final_payment_amount
    'FLD-000206': currency,                                                                              // document.deal_currency
    'FLD-000208': dateRu(paidAt),                                                                        // document.payment_date

    // ── payment.* (FLD-000256..267) — read from documentData.payment snapshot ─
    'FLD-000256': pay?.method || '',                                                            // payment.method
    'FLD-000257': pay?.method_label || '',                                                      // payment.method_label
    'FLD-000258': pay?.description || '',                                                       // payment.description
    'FLD-000259': pay?.card_brand || '',                                                        // payment.card.brand
    'FLD-000260': pay?.card_brand_normalized || '',                                             // payment.card.brand_normalized
    'FLD-000261': pay?.card_last4 || '',                                                        // payment.card.last4
    'FLD-000262': pay?.card_holder || '',                                                       // payment.card.holder
    'FLD-000263': pay?.paid_at ? dotDate(pay.paid_at) : '',                                     // payment.paid_at
    // payment.amount — ТОЛЬКО число без валюты ("100,00"). Валюта рядом — FLD-000265.
    // Сумма прописью с валютой — отдельный FLD-000370 (payment.amount_words).
    'FLD-000264': pay?.amount != null ? Number(pay.amount).toFixed(2).replace('.', ',') : '',   // payment.amount → "100,00"
    'FLD-000265': (pay?.currency || '').toString().toUpperCase(),                               // payment.currency
    'FLD-000266': pay?.provider_transaction_id || '',                                           // payment.provider_transaction_id
    'FLD-000267': pay?.external_reference || '',                                                // payment.external_reference
    // payment.amount_words — сумма платежа прописью с учётом валюты платежа.
    // Источник currency: payments_v2.currency → fallback на order currency → 'BYN' (warning внутри formatter).
    'FLD-000370': pay?.amount != null
      ? formatAmountWithWordsByRublesAndKopecks(Number(pay.amount), pay?.currency || currency || 'BYN')
      : '',                                                                                     // payment.amount_words
  };

  return v;
}

/**
 * Merge standard values into existing fields. Preserves manual_override.
 * Marks each entry with source='snapshot_standard'.
 */
export function mergeStandardIntoFields(
  fields: Record<string, any>,
  values: Record<string, string>,
  nowIso: string,
): { fields: Record<string, any>; written: number; skipped_manual: number } {
  const out = { ...fields };
  let written = 0;
  let skipped_manual = 0;
  for (const [fid, val] of Object.entries(values)) {
    const existing = out[fid];
    if (existing && existing.manual_override === true) {
      skipped_manual += 1;
      continue;
    }
    out[fid] = {
      value: val ?? '',
      source: 'snapshot_standard',
      manual_override: false,
      updated_at: nowIso,
    };
    written += 1;
  }
  return { fields: out, written, skipped_manual };
}
