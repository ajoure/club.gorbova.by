// ============================================================================
// document-data-snapshot.ts — Sprint 10
// ----------------------------------------------------------------------------
// Idempotent snapshot of document_data into orders_v2.meta.document_data.
//
// Sources priority (build-time):
//   1) tariff_offers.meta.document_defaults
//   2) product_tariffs.meta.document_defaults
//   3) products_v2.meta.document_defaults
//   4) orders_v2 live fields (final_price, currency, paid_at, ids)
//   5) computed: amount_words, currency_major/minor, periods, document_date
//
// Rules:
//   - If orders_v2.meta.document_data already exists → skip (audit
//     `document_data.snapshot_skipped_exists`).
//   - Never throws. Errors logged + audit `document_data.snapshot_failed`.
//   - Does NOT generate any document. Does NOT send anything.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { numberToWordsRu, normalizeCurrency } from './docx-helpers.ts';
import { resolveExecutorForOrder, buildExecutorFieldValues, mergeExecutorIntoFields } from './executor-fields.ts';

export const SNAPSHOT_VERSION = '1.1';

const CURRENCY_WORDS: Record<string, { major: string; minor: string }> = {
  BYN: { major: 'рублей', minor: 'копеек' },
  USD: { major: 'долларов США', minor: 'центов' },
  EUR: { major: 'евро', minor: 'центов' },
  RUB: { major: 'рублей', minor: 'копеек' },
};

function currencyMajorMinor(currency?: string | null) {
  const code = (currency || '').toUpperCase();
  return CURRENCY_WORDS[code] || { major: '', minor: '' };
}

function safeAudit(supabase: any, action: string, meta: any) {
  return supabase.from('audit_logs').insert({
    actor_user_id: null,
    actor_type: 'system',
    actor_label: 'document-data-snapshot',
    action,
    meta,
  }).then(() => undefined, () => undefined);
}

export interface SnapshotResult {
  status: 'created' | 'skipped_exists' | 'skipped_no_order' | 'skipped_not_paid' | 'failed';
  reason?: string;
  document_data?: Record<string, unknown>;
}

/**
 * Idempotent snapshot. Caller is responsible for invoking it on the
 * canonical paid/access flow (e.g. after grant-access succeeds).
 */
export async function snapshotOrderDocumentData(
  supabase: any,
  orderId: string,
): Promise<SnapshotResult> {
  try {
    const { data: order } = await supabase
      .from('orders_v2')
      .select('id, status, product_id, tariff_id, offer_id, final_price, base_price, currency, paid_at, created_at, meta')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return { status: 'skipped_no_order' };

    const existing = (order.meta as any)?.document_data;
    if (existing && typeof existing === 'object') {
      await safeAudit(supabase, 'document_data.snapshot_skipped_exists', {
        order_id: orderId,
        snapshot_version: existing.snapshot_version || null,
      });
      return { status: 'skipped_exists' };
    }

    if (order.status !== 'paid') {
      return { status: 'skipped_not_paid', reason: `order_status_${order.status}` };
    }

    // Pull layered defaults (offer → tariff → product).
    let offerDefaults: any = null;
    let tariffDefaults: any = null;
    let productDefaults: any = null;

    if (order.offer_id) {
      const { data } = await supabase
        .from('tariff_offers').select('meta').eq('id', order.offer_id).maybeSingle();
      offerDefaults = data?.meta?.document_defaults || null;
    }
    if (order.tariff_id) {
      const { data } = await supabase
        .from('product_tariffs').select('meta').eq('id', order.tariff_id).maybeSingle();
      tariffDefaults = data?.meta?.document_defaults || null;
    }
    if (order.product_id) {
      const { data } = await supabase
        .from('products_v2').select('meta').eq('id', order.product_id).maybeSingle();
      productDefaults = data?.meta?.document_defaults || null;
    }

    // Layered pick (offer wins, then tariff, then product).
    const pick = <T,>(key: string): T | null => {
      const o = offerDefaults?.[key];
      if (o !== undefined && o !== null && o !== '') return o as T;
      const t = tariffDefaults?.[key];
      if (t !== undefined && t !== null && t !== '') return t as T;
      const p = productDefaults?.[key];
      if (p !== undefined && p !== null && p !== '') return p as T;
      return null;
    };

    const liveAmount = order.final_price != null ? Number(order.final_price) : null;
    const liveCurrencyRaw = order.currency || pick<string>('currency') || 'BYN';
    const normCurrency = normalizeCurrency(liveCurrencyRaw) === 'UNKNOWN'
      ? liveCurrencyRaw
      : normalizeCurrency(liveCurrencyRaw);

    const overrideAmount = offerDefaults?.amount_manual_override === true
      ? (offerDefaults?.amount ?? null)
      : null;
    const amount = overrideAmount != null ? Number(overrideAmount) : liveAmount;

    const quantity = (() => {
      const q = pick<number>('quantity');
      return q != null && Number(q) > 0 ? Number(q) : 1;
    })();

    const unitPrice = (() => {
      const u = pick<number>('unit_price');
      if (u != null && Number(u) > 0) return Number(u);
      if (amount != null && quantity > 0) return Number((amount / quantity).toFixed(2));
      return null;
    })();

    const cm = currencyMajorMinor(normCurrency);

    const paidAt = order.paid_at || order.created_at || new Date().toISOString();
    const actDate = paidAt;

    // Service period — use offer/tariff defaults if present; else fallback to
    // [paid_at, paid_at + months_count*30] when months_count provided.
    let periodFrom = pick<string>('service_period_from');
    let periodTo = pick<string>('service_period_to');
    const monthsCount = pick<number>('months_count');
    if (!periodFrom && paidAt) periodFrom = paidAt.slice(0, 10);
    if (!periodTo && periodFrom && monthsCount) {
      const d = new Date(periodFrom);
      d.setMonth(d.getMonth() + Number(monthsCount));
      periodTo = d.toISOString().slice(0, 10);
    }

    const documentData = {
      snapshot_version: SNAPSHOT_VERSION,
      snapshotted_at: new Date().toISOString(),
      source: {
        product_id: order.product_id || null,
        tariff_id: order.tariff_id || null,
        offer_id: order.offer_id || null,
        order_id: order.id,
      },
      template_id: pick<string>('template_id'),
      executor_id: pick<string>('executor_id'),
      service_name: pick<string>('service_name'),
      service_description: pick<string>('service_description'),
      unit: pick<string>('unit') || 'услуга',
      quantity,
      unit_price: unitPrice,
      amount,
      amount_words: amount != null ? numberToWordsRu(amount, normCurrency) : '',
      currency: normCurrency,
      currency_major: cm.major,
      currency_minor: cm.minor,
      payment_due_days: pick<number>('payment_due_days'),
      execution_days: pick<number>('execution_days'),
      service_period_from: periodFrom || null,
      service_period_to: periodTo || null,
      months_count: monthsCount ?? null,
      prepayment_percent: pick<number>('prepayment_percent') ?? 0,
      prepayment_amount: pick<number>('prepayment_amount') ?? 0,
      discount_amount: pick<number>('discount_amount') ?? 0,
      first_payment: pick<number>('first_payment') ?? amount,
      bank_credit_price: pick<number>('bank_credit_price') ?? amount,
      final_payment: pick<number>('final_payment') ?? 0,
      comment: pick<string>('comment') ?? null,
      // Lineage of which layers contributed (for audit).
      _provenance: {
        offer_defaults_present: !!offerDefaults,
        tariff_defaults_present: !!tariffDefaults,
        product_defaults_present: !!productDefaults,
        order_paid_at: paidAt,
        order_currency: liveCurrencyRaw,
      },
    };

    // Resolve executor and pre-populate executor.* FLD fields (entity_type='executor').
    // These FLDs are NEVER user-editable (see canonical-deal-fields-update guard).
    const explicitExecutorId = (offerDefaults?.executor_id
      ?? tariffDefaults?.executor_id
      ?? productDefaults?.executor_id
      ?? null) as string | null;
    const { executor, source: execSource, executor_id: resolvedExecutorId } =
      await resolveExecutorForOrder(supabase, explicitExecutorId);
    const fields: Record<string, any> = {};
    let executorTrace: Record<string, string> | null = null;
    if (executor && execSource && resolvedExecutorId) {
      const values = buildExecutorFieldValues(executor);
      const merged = mergeExecutorIntoFields(fields, values, execSource, resolvedExecutorId, new Date().toISOString());
      Object.assign(fields, merged.fields);
      executorTrace = merged.trace;
      (documentData as any).executor_id = resolvedExecutorId;
      (documentData as any).executor_source = execSource;
    } else {
      await safeAudit(supabase, 'document_data.snapshot_executor_missing', {
        order_id: orderId,
        explicit_executor_id: explicitExecutorId,
      });
    }
    (documentData as any).fields = fields;

    const newMeta = { ...(order.meta || {}), document_data: documentData };
    const { error: upErr } = await supabase
      .from('orders_v2').update({ meta: newMeta }).eq('id', orderId);
    if (upErr) {
      await safeAudit(supabase, 'document_data.snapshot_failed', {
        order_id: orderId, error: upErr.message,
      });
      return { status: 'failed', reason: upErr.message };
    }

    await safeAudit(supabase, 'document_data.snapshot_created', {
      order_id: orderId,
      snapshot_version: SNAPSHOT_VERSION,
      template_id: documentData.template_id,
      executor_id: (documentData as any).executor_id || null,
      executor_source: (documentData as any).executor_source || null,
      executor_trace: executorTrace,
      amount: documentData.amount,
      currency: documentData.currency,
      provenance: documentData._provenance,
    });

    return { status: 'created', document_data: documentData };
  } catch (e: any) {
    await safeAudit(supabase, 'document_data.snapshot_failed', {
      order_id: orderId, error: e?.message || String(e),
    });
    return { status: 'failed', reason: e?.message || 'internal' };
  }
}
