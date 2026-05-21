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
import { normalizeCurrency } from './docx-helpers.ts';
import { formatAmountWithWordsByRublesAndKopecks } from './amount-with-words.ts';
import { resolveExecutorForOrder, buildExecutorFieldValues, mergeExecutorIntoFields } from './executor-fields.ts';
import { buildStandardFieldValues, mergeStandardIntoFields } from './standard-fields.ts';
import { derivePaymentChannel } from './document-resolver-v2/payment-channel.ts';
import { resolveDocumentScenario, type PayerType } from './document-scenario-resolver.ts';
import { buildTypedB97FieldValues, mergeTypedB97IntoFields } from './typed-fld-mapping.ts';

export const SNAPSHOT_VERSION = '1.3';

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
    const { data: order, error: orderErr } = await supabase
      .from('orders_v2')
      .select('id, order_number, status, profile_id, user_id, product_id, tariff_id, offer_id, final_price, base_price, currency, customer_email, customer_phone, deal_date, updated_at, created_at, meta')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr) {
      await safeAudit(supabase, 'document_data.snapshot_error', {
        order_id: orderId, table: 'orders_v2', stage: 'load_order', error: orderErr.message,
      });
      return { status: 'failed', reason: `orders_v2:${orderErr.message}` };
    }
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

    // Pull layered defaults (offer → tariff → product) and full rows for
    // standard-fields resolver.
    let offerDefaults: any = null;
    let tariffDefaults: any = null;
    let productDefaults: any = null;
    let offerRow: any = null;
    let tariffRow: any = null;
    let productRow: any = null;

    // Resolve offer_id with fallback to meta.offer_id (admin_test, recurring resolver paths).
    const orderMetaAny: any = order.meta || {};
    const offerIdFromMeta = typeof orderMetaAny.offer_id === 'string' ? orderMetaAny.offer_id : null;
    const resolvedOfferId: string | null = order.offer_id || offerIdFromMeta;
    const offerIdSource: 'order' | 'order_meta' | 'none' =
      order.offer_id ? 'order' : (offerIdFromMeta ? 'order_meta' : 'none');

    if (resolvedOfferId) {
      const { data, error } = await supabase
        .from('tariff_offers')
        .select('id, tariff_id, offer_type, button_label, amount, reentry_amount, meta')
        .eq('id', resolvedOfferId).maybeSingle();
      if (error) {
        await safeAudit(supabase, 'document_data.snapshot_error', {
          order_id: orderId, table: 'tariff_offers', stage: 'load_offer', error: error.message,
        });
      }
      offerRow = data || null;
      offerDefaults = data?.meta?.document_defaults || null;
    }
    if (order.tariff_id) {
      const { data, error } = await supabase
        .from('tariffs')
        .select('id, name, description, access_days, meta')
        .eq('id', order.tariff_id).maybeSingle();
      if (error) {
        await safeAudit(supabase, 'document_data.snapshot_error', {
          order_id: orderId, table: 'tariffs', stage: 'load_tariff', error: error.message,
        });
      }
      tariffRow = data || null;
      tariffDefaults = data?.meta?.document_defaults || null;
    }
    if (order.product_id) {
      const { data, error } = await supabase
        .from('products_v2')
        .select('id, name, slug, code, description, currency, meta')
        .eq('id', order.product_id).maybeSingle();
      if (error) {
        await safeAudit(supabase, 'document_data.snapshot_error', {
          order_id: orderId, table: 'products_v2', stage: 'load_product', error: error.message,
        });
      }
      productRow = data || null;
      productDefaults = data?.meta?.document_defaults || null;
    }

    // Customer legal_details — Sprint B: payer_type-aware cohort.
    // SOT: orders_v2.payer_type. Match client_type=payer_type, prefer is_default,
    // then most recently updated. Fallback to any default row + warning.
    let customerRow: any = null;
    let customerResolutionSource = 'none';
    const orderPayerTypeForCustomer: PayerType = (order as any).payer_type === 'legal_entity'
      ? 'legal_entity' : 'individual';
    if (order.profile_id) {
      const { data: cohort, error: cohortErr } = await supabase
        .from('client_legal_details')
        .select('*')
        .eq('profile_id', order.profile_id)
        .eq('client_type', orderPayerTypeForCustomer)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1);
      if (cohortErr) {
        await safeAudit(supabase, 'document_data.snapshot_error', {
          order_id: orderId, table: 'client_legal_details', stage: 'load_customer_cohort', error: cohortErr.message,
        });
      }
      if (cohort && cohort.length > 0) {
        customerRow = cohort[0];
        customerResolutionSource = `cohort_${orderPayerTypeForCustomer}`;
      } else {
        const { data: fallback, error } = await supabase
          .from('client_legal_details')
          .select('*')
          .eq('profile_id', order.profile_id)
          .eq('is_default', true)
          .maybeSingle();
        if (error) {
          await safeAudit(supabase, 'document_data.snapshot_error', {
            order_id: orderId, table: 'client_legal_details', stage: 'load_customer_fallback', error: error.message,
          });
        }
        customerRow = fallback || null;
        if (customerRow) {
          customerResolutionSource = `fallback_default_${customerRow.client_type || 'unknown'}`;
        }
      }
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

    const paidAt = (order as any).deal_date || (order as any).updated_at || order.created_at || new Date().toISOString();
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

    // === Sprint 12: priority resolver ============================================
    // template_id / executor_id выбираются в порядке:
    //   1. orders_v2.meta.documents.template_override / executor_override (manual)
    //   2. matched tariff_offers.meta.document_scenarios[]                 (live)
    //   3. tariff_offers.meta.document_defaults                            (fallback)
    //   4. block/warning, если значения нет
    // На моменте создания snapshot шаг 1 обычно пуст (override может быть задан позже).
    // ================================================================================
    const documentsMeta: any = orderMetaAny?.documents || {};
    const templateOverride: string | null = documentsMeta?.template_override || null;
    const executorOverride: string | null = documentsMeta?.executor_override || null;

    // payer_type: SOT-колонка orders_v2.payer_type, fallback 'individual'.
    const orderPayerType: PayerType = (order as any).payer_type === 'legal_entity'
      ? 'legal_entity' : 'individual';

    // Определяем канал по последнему succeeded платежу (read-only).
    // Sprint A: расширенный select для payment.* namespace в renderer.
    const { data: paysForChannel } = await supabase
      .from('payments_v2')
      .select('id, status, card_last4, card_brand, card_holder, provider, provider_payment_id, amount, currency, meta, paid_at, created_at')
      .eq('order_id', orderId)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    const succPay = (paysForChannel || []).find((p: any) => p.status === 'succeeded') || null;
    const paymentChannel = derivePaymentChannel(succPay as any);

    // Sprint A — payment.* snapshot block.
    // SOT: последний succeeded payment по order_id. Не пишем ничего в payments_v2.
    // Renderer overlay: snapshot.payment → live payments_v2 → empty + warning.
    function buildPaymentBlock(p: any, channel: string | null): any {
      if (!p) {
        return {
          payment_id: null,
          provider: null,
          payment_channel: channel || null,
          method: null,
          method_label: null,
          description: null,
          card_brand: null,
          card_brand_normalized: null,
          card_last4: null,
          card_holder: null,
          paid_at: null,
          amount: null,
          currency: null,
          provider_transaction_id: null,
          external_reference: null,
          selection_reason: 'no_succeeded_payment',
        };
      }
      const meta = p.meta || {};
      const brand = p.card_brand || null;
      const brandNorm = brand
        ? String(brand).toLowerCase().replace(/[^a-z0-9]+/g, '_')
        : null;
      const channelLabels: Record<string, string> = {
        card: 'Банковская карта',
        apple_pay: 'Apple Pay',
        google_pay: 'Google Pay',
        erip: 'ЕРИП',
        bank_transfer: 'Банковский перевод',
      };
      const methodCode = channel || (p.provider === 'bepaid' ? 'card' : (p.provider || 'unknown'));
      const methodLabel = channelLabels[methodCode] || methodCode;
      // Description: формируется из факта платежа (см. plan §6).
      let description: string;
      const last4 = p.card_last4 || null;
      const holder = p.card_holder || null;
      const txnId = p.provider_payment_id || null;
      if (channel === 'card' || channel === 'apple_pay' || channel === 'google_pay') {
        const parts = [methodLabel];
        if (brand) parts.push(brand);
        if (last4) parts.push(`**** ${last4}`);
        if (holder) parts.push(holder);
        description = parts.filter(Boolean).join(', ');
      } else if (channel === 'erip') {
        description = txnId ? `ЕРИП, операция ${txnId}` : 'ЕРИП';
      } else if (channel === 'bank_transfer') {
        description = txnId ? `Банковский перевод, № ${txnId}` : 'Банковский перевод';
      } else {
        const parts = [methodLabel];
        if (txnId) parts.push(txnId);
        description = parts.filter(Boolean).join(', ') || (meta.description || '');
      }
      return {
        payment_id: p.id || null,
        provider: p.provider || null,
        payment_channel: channel || null,
        method: methodCode,
        method_label: methodLabel,
        description,
        card_brand: brand,
        card_brand_normalized: brandNorm,
        card_last4: last4,
        card_holder: holder,
        paid_at: p.paid_at || p.created_at || null,
        amount: p.amount != null ? Number(p.amount) : null,
        currency: p.currency || null,
        provider_transaction_id: txnId,
        external_reference: meta.external_reference || meta.external_ref || null,
        selection_reason: 'last_succeeded_by_paid_at',
      };
    }
    const paymentBlock = buildPaymentBlock(succPay, paymentChannel);

    const offerMetaForResolver = offerRow?.meta || {};
    const scenarioResolved = resolveDocumentScenario(
      offerMetaForResolver,
      paymentChannel,
      orderPayerType,
    );

    // Layered template_id: override → scenario → defaults
    const finalTemplateId: string | null =
      templateOverride
        || (scenarioResolved.source === 'scenario' ? scenarioResolved.template_id : null)
        || pick<string>('template_id')
        || null;

    // Layered executor_id: override → scenario → defaults (через resolveExecutorForOrder)
    const explicitExecutorIdLayered: string | null =
      executorOverride
        || (scenarioResolved.source === 'scenario' ? scenarioResolved.executor_id : null)
        || (offerDefaults?.executor_id
          ?? tariffDefaults?.executor_id
          ?? productDefaults?.executor_id
          ?? null);

    const documentData = {
      snapshot_version: SNAPSHOT_VERSION,
      snapshotted_at: new Date().toISOString(),
      source: {
        product_id: order.product_id || null,
        tariff_id: order.tariff_id || null,
        offer_id: resolvedOfferId,
        order_id: order.id,
      },
      template_id: finalTemplateId,
      executor_id: explicitExecutorIdLayered,
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
      // Sprint A — payment.* SOT block (read-only snapshot of succeeded payments_v2 row).
      payment: paymentBlock,
      _provenance: {
        offer_defaults_present: !!offerDefaults,
        tariff_defaults_present: !!tariffDefaults,
        product_defaults_present: !!productDefaults,
        offer_id: resolvedOfferId,
        offer_id_source: offerIdSource,
        tariff_id: order.tariff_id || null,
        product_id: order.product_id || null,
        order_paid_at: paidAt,
        order_currency: liveCurrencyRaw,
        // Sprint 12 — scenario resolution snapshot.
        scenario: {
          source: scenarioResolved.source,
          scenario_id: scenarioResolved.scenario_id,
          payer_type: orderPayerType,
          payment_channel: paymentChannel,
          requires_required_requisites: scenarioResolved.requires_required_requisites,
        },
        template_resolution: {
          source: templateOverride
            ? 'override'
            : scenarioResolved.source === 'scenario'
              ? 'scenario'
              : (pick<string>('template_id') ? 'defaults' : 'none'),
          final_template_id: finalTemplateId,
        },
        executor_resolution: {
          source: executorOverride
            ? 'override'
            : (scenarioResolved.source === 'scenario' && scenarioResolved.executor_id)
              ? 'scenario'
              : ((offerDefaults?.executor_id ?? tariffDefaults?.executor_id ?? productDefaults?.executor_id)
                  ? 'defaults'
                  : 'none'),
          final_executor_id: explicitExecutorIdLayered,
        },
      },
    };


    // Resolve executor and pre-populate executor.* FLD fields (entity_type='executor').
    // These FLDs are NEVER user-editable (see canonical-deal-fields-update guard).
    // Используем layered executor_id: override → scenario → defaults.
    const explicitExecutorId = explicitExecutorIdLayered;
    const { executor, source: execSource, executor_id: resolvedExecutorId } =
      await resolveExecutorForOrder(supabase, explicitExecutorId);
    const fields: Record<string, any> = {};
    const nowIso = new Date().toISOString();

    // Standard (non-executor) field values: customer.*, deal.*, order.*,
    // system.*, product.*, tariff.*, offer.*, document.service_*.
    const standardValues = buildStandardFieldValues({
      order,
      product: productRow,
      tariff: tariffRow,
      offer: offerRow,
      customer: customerRow,
      documentData,
    });
    const stdMerged = mergeStandardIntoFields(fields, standardValues, nowIso);
    Object.assign(fields, stdMerged.fields);

    // Executor.* (entity_type='executor') — never user-editable.
    let executorTrace: Record<string, string> | null = null;
    if (executor && execSource && resolvedExecutorId) {
      const values = buildExecutorFieldValues(executor);
      const merged = mergeExecutorIntoFields(fields, values, execSource, resolvedExecutorId, nowIso);
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

    // B-97 typed FLDs (FLD-000273..FLD-000369): customer.{ind,leg,ent}.*
    // и executor.leg.* — материализуем по FLD-id, чтобы strict-generator,
    // который читает только docFields[fid], нашёл значения и не пометил
    // их как missing. SOT — buildTypedNamespaceValues(customer, executor).
    // Postponed-токены (executor.ind/ent + executor.leg.org_form) НЕ входят
    // в этот scope: их FLD ещё не созданы в реестре.
    const typedB97Values = buildTypedB97FieldValues(customerRow, executor);
    const typedB97Merged = mergeTypedB97IntoFields(fields, typedB97Values, nowIso);
    Object.assign(fields, typedB97Merged.fields);

    (documentData as any).fields = fields;
    (documentData as any)._provenance = {
      ...(documentData as any)._provenance,
      customer_legal_details_id: customerRow?.id || null,
      customer_legal_details_present: !!customerRow,
      customer_resolution: {
        payer_type: orderPayerTypeForCustomer,
        source: customerResolutionSource,
        client_type: customerRow?.client_type || null,
        mismatch: !!customerRow && customerRow.client_type !== orderPayerTypeForCustomer,
      },
      standard_fields_written: stdMerged.written,
      standard_fields_skipped_manual: stdMerged.skipped_manual,
      typed_b97_fields_written: typedB97Merged.written,
      typed_b97_fields_non_empty: typedB97Merged.non_empty,
      typed_b97_fields_skipped_manual: typedB97Merged.skipped_manual,
    };


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
