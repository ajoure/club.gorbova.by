// Phase 2 — stripe-webhook
// verify_jwt = false. Public endpoint. Stripe-Signature header verified against
// vault-stored webhook_signing_secret (per account_code).
//
// Pipeline:
//   1) read RAW body (NEVER JSON-parse before signature check)
//   2) try each active stripe connection's webhook secret until one verifies
//   3) INSERT provider_events ON CONFLICT (idempotency_key) DO NOTHING
//      - if conflict → 200 {status:'skipped_duplicate'}
//   4) dispatch handler by event_type
//   5) UPDATE processing_status
//
// Handlers (MVP):
//   - checkout.session.completed   → call grant-access-for-order
//   - checkout.session.expired     → audit only
//   - payment_intent.succeeded     → dedup; payments_v2 insert if absent
//   - payment_intent.payment_failed→ audit + orders_v2.meta merge
//   - charge.refunded              → record_refund_atomic RPC
//   - charge.dispute.created       → log only
//
// Strict add-only: bepaid-* untouched; grant-access-for-order is CALLED, not modified.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyStripeSignature } from '../_shared/acquiring/stripe-signature.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { applyCrmStageOnTerminal } from '../_shared/crm-routing.ts';
import {
  resolveStripeSubscriptionEvent,
  STRIPE_SUBSCRIPTION_EVENT_TYPES,
} from '../_shared/stripe-subscription-resolver.ts';
import { consumePaymentLinkForOrder } from '../_shared/consume-payment-link.ts';
import { materializeStripeDocumentLinks } from '../_shared/stripe-receipt-materialize.ts';
import { activateStripeSubscriptionCheckout } from '../_shared/stripe-checkout-materialize.ts';
// PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — единый writer card snapshot.
import { enrichStripePaymentCardData } from '../_shared/stripe/card-enrichment.ts';
// PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2
import {
  notifyAdminPaymentEvent,
  resolveInvoiceNotifyDecision,
  orderedRefundCandidates,
  type RefundRecord,
} from '../_shared/stripe-admin-notify.ts';

// PATCH-V2: atomic insert-winner for Stripe single-charge payments.
// Relies on existing partial UNIQUE `(provider, provider_payment_id)` on payments_v2.
// Returns inserted=true ONLY when this call created the row. Race between
// checkout.session.completed and payment_intent.succeeded carrying the same pi_*
// is decided by the database constraint (23505). Notify caller is gated on inserted=true.
//
// Strict 23505 handling (PARITY-V2 fix-to-patch):
//   - 23505 is interpreted as "another writer won" ONLY when a matching row with the
//     same (provider='stripe', provider_payment_id=pi_id) actually exists.
//   - If no matching row is found after 23505, the original DB error is re-thrown.
//     This prevents masking unrelated unique violations as a duplicate payment.
export async function persistStripePaymentIfAbsent(
  supabase: ReturnType<typeof svc>,
  pi_id: string,
  row: Record<string, unknown>,
): Promise<{ payment_id: string | null; inserted: boolean }> {
  const insertRes = await supabase
    .from('payments_v2')
    .insert(row)
    .select('id')
    .maybeSingle();
  if (!insertRes.error && insertRes.data?.id) {
    return { payment_id: insertRes.data.id, inserted: true };
  }
  const err = insertRes.error;
  const isUniqueViolation = err?.code === '23505'
    || /duplicate key|unique constraint/i.test(err?.message ?? '');
  if (isUniqueViolation) {
    const { data: existing } = await supabase
      .from('payments_v2')
      .select('id')
      .eq('provider', 'stripe')
      .eq('provider_payment_id', pi_id)
      .maybeSingle();
    if (existing?.id) {
      return { payment_id: existing.id, inserted: false };
    }
    // 23505 but no row with this pi_* — some other unique constraint fired.
    // Re-throw so caller does NOT treat this as a duplicate Stripe payment.
    throw new Error(`payments_v2 unique_violation without matching pi_*: ${err?.message ?? 'unknown'}`);
  }
  if (err) {
    console.warn(`[stripe-webhook] persistStripePaymentIfAbsent error pi=${pi_id}:`, err.message);
  }
  return { payment_id: null, inserted: false };
}



function svc() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  livemode: boolean;
  account?: string;
}

const ZERO_DECIMAL = new Set<string>(['JPY', 'KRW', 'VND']);
function toMajorUnits(minor: number, currency: string): number {
  const cur = currency.toUpperCase();
  if (ZERO_DECIMAL.has(cur)) return minor;
  return Math.round(minor) / 100;
}

async function transitionOrderPaid(
  supabase: ReturnType<typeof svc>,
  order_id: string,
  amountMajor: number,
  currency: string,
  provider_payment_id: string,
) {
  // Idempotent transition; do not regress from paid → paid (skip if already paid AND amount set).
  const { data: ord } = await supabase
    .from('orders_v2')
    .select('id, status, paid_amount')
    .eq('id', order_id)
    .maybeSingle();
  if (!ord) return;
  if (ord.status === 'paid' && Number(ord.paid_amount ?? 0) > 0) return;
  await supabase
    .from('orders_v2')
    .update({
      status: 'paid',
      paid_amount: amountMajor,
      currency: currency.toUpperCase(),
      provider_payment_id,
    })
    .eq('id', order_id);
}

// PRR-FIX-02 (F4): merge sticky Stripe metadata + business_stream into orders_v2.meta.
// Immutable fields (checkout_session_id, payment_intent_id) are set-if-absent;
// charge_id / customer_id last-write-wins.
async function mergeStripeMetaOnOrder(
  supabase: ReturnType<typeof svc>,
  order_id: string,
  patch: {
    checkout_session_id?: string | null;
    payment_intent_id?: string | null;
    charge_id?: string | null;
    customer_id?: string | null;
    account_code?: string | null;
    business_stream?: string | null;
    payment_link_id?: string | null;
  },
) {
  const { data: ord } = await supabase
    .from('orders_v2')
    .select('meta')
    .eq('id', order_id)
    .maybeSingle();
  if (!ord) return;
  const curMeta = (ord.meta && typeof ord.meta === 'object') ? ord.meta as Record<string, unknown> : {};
  const curStripe = (curMeta.stripe && typeof curMeta.stripe === 'object') ? curMeta.stripe as Record<string, unknown> : {};
  const nextStripe: Record<string, unknown> = { ...curStripe };
  // set-if-absent for immutable
  if (patch.checkout_session_id && !nextStripe.checkout_session_id) nextStripe.checkout_session_id = patch.checkout_session_id;
  if (patch.payment_intent_id && !nextStripe.payment_intent_id) nextStripe.payment_intent_id = patch.payment_intent_id;
  // last-write-wins
  if (patch.charge_id) nextStripe.charge_id = patch.charge_id;
  if (patch.customer_id) nextStripe.customer_id = patch.customer_id;
  if (patch.account_code) nextStripe.account_code = patch.account_code;
  if (patch.business_stream) nextStripe.business_stream = patch.business_stream;

  const nextMeta: Record<string, unknown> = { ...curMeta, stripe: nextStripe };
  if (patch.business_stream && !curMeta.business_stream) {
    nextMeta.business_stream = patch.business_stream;
  }
  // Phase 4.3: set-if-absent payment_link_id (top-level) so consumePaymentLinkForOrder
  // can resolve it. Never overwrite an existing value (sticky, immutable).
  if (patch.payment_link_id && !curMeta.payment_link_id) {
    nextMeta.payment_link_id = patch.payment_link_id;
  }
  await supabase.from('orders_v2').update({ meta: nextMeta }).eq('id', order_id);
}

// Phase 8-B/C — Stripe receipt/invoice link materialization (reuse existing fields).
// See supabase/functions/_shared/stripe-receipt-materialize.ts for contract.






async function dispatch(event: StripeEvent, account_code: string): Promise<{ order_id?: string; payment_id?: string; note?: string }> {
  const supabase = svc();

  // Phase 3.1 Stage 2 — subscription lifecycle (add-only).
  // Routes through _shared/stripe-subscription-resolver.ts.
  // НЕ требует order_id_meta (resolver сам резолвит subv2 через provider_subscriptions).
  if (STRIPE_SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    const out = await resolveStripeSubscriptionEvent(supabase, event, account_code);
    if (out) {
      // PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2: после того как существующий
      // onInvoicePaid lifecycle материализовал payment_id, обогащаем card snapshot.
      // НЕ создаём payment row, НЕ повторяем lifecycle, НЕ меняем access.
      // Никогда не падаем — enrichment не должен ломать activation.
      if (event.type === 'invoice.paid' && out.payment_id && !out.manual_review) {
        try {
          const { data: paymentRow } = await supabase
            .from('payments_v2')
            .select('provider_payment_id, meta')
            .eq('id', out.payment_id)
            .maybeSingle();
          const piFromRow = (typeof paymentRow?.provider_payment_id === 'string'
            && /^pi_[A-Za-z0-9_]+$/.test(paymentRow.provider_payment_id))
            ? paymentRow.provider_payment_id
            : (paymentRow?.meta?.stripe?.payment_intent_id ?? null);
          if (piFromRow && /^pi_[A-Za-z0-9_]+$/.test(piFromRow)) {
            await enrichStripePaymentCardData({
              supabase,
              paymentId: out.payment_id,
              paymentIntentId: piFromRow,
              accountCode: account_code,
              source: 'invoice.paid',
              actor: { type: 'system', label: 'Stripe webhook card enrichment' },
              fetchStripeSecret: (code) => readAcquiringSecret('stripe', code, 'secret_key').catch(() => null),
            });
          }
        } catch { /* never re-throw — invoice.paid activation already committed */ }
      }
      // PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2
      // Decision table (canonical):
      //   subscription_create  → NO notify (first charge already covered by PI/checkout)
      //   subscription_cycle   → recurring notify
      //   subscription_update / manual / null / unknown → NO notify (+ safe log)
      if (event.type === 'invoice.paid') {
        const inv = event.data.object as Record<string, unknown>;
        const billing_reason = typeof inv.billing_reason === 'string' ? inv.billing_reason : null;
        const decision = resolveInvoiceNotifyDecision({
          billing_reason,
          manual_review: !!out.manual_review,
          payment_id: out.payment_id ?? null,
          resolver_note: out.note ?? null,
        });
        if (decision.notify) {
          try {
            const amount_minor = Number(inv.amount_paid ?? inv.amount_due ?? 0);
            const inv_currency = String(inv.currency ?? 'usd').toUpperCase();
            const inv_amount_major = toMajorUnits(amount_minor, inv_currency);
            const period_end = typeof inv.period_end === 'number' ? inv.period_end : null;
            const next_charge_at = period_end ? new Date(period_end * 1000).toISOString() : null;
            notifyAdminPaymentEvent(supabase, {
              op: 'subscription_renewal',
              order_id: out.order_id!,
              payment_id: out.payment_id!,
              provider_object_id: (inv.id as string) ?? null,
              amount: inv_amount_major,
              currency: inv_currency,
              next_charge_at,
            });
          } catch { /* notify is best-effort */ }
        } else {
          console.log(`[stripe-webhook] invoice.paid notify skipped: ${decision.reason} (billing_reason=${billing_reason})`);
        }
      }
      // Map resolver result → webhook output shape.
      // manual_review остаётся в note, чтобы processing_status выставился ниже.
      const note = out.manual_review
        ? `manual_review:${out.manual_review_reason ?? 'unknown'}`
        : out.note;
      return { order_id: out.order_id, payment_id: out.payment_id, note };
    }
  }


  const obj = event.data.object as Record<string, unknown>;
  const md = (obj.metadata ?? {}) as Record<string, string>;
  const meta_account_code = md.account_code;
  const order_id_meta = md.order_id ?? (obj.client_reference_id as string | undefined);

  // PATCH: Stripe subscription checkout materialization (recovery / safety path).
  // Если это checkout.session.completed для subscription и invoice.paid не пришёл —
  // подтягиваем invoice из Stripe API и делегируем onInvoicePaid (canonical).
  // Идемпотентно: при последующем реальном invoice.paid дубль не создастся.
  if (event.type === 'checkout.session.completed' && String(obj.mode ?? '') === 'subscription') {
    const out = await activateStripeSubscriptionCheckout(supabase, {
      session: obj,
      account_code,
      source_event_id: event.id,
      source: 'stripe.webhook.checkout.session.completed',
    });
    const note = out.manual_review
      ? `manual_review:${out.manual_review_reason ?? out.skipped ?? 'unknown'}`
      : (out.note ?? out.skipped);
    return { order_id: out.order_id, payment_id: out.payment_id, note };
  }

  // Cross-check resolved (from webhook secret) vs metadata account_code
  if (meta_account_code && meta_account_code !== account_code) {
    return { note: 'account_code_mismatch' };
  }
  if (!order_id_meta) {
    return { note: 'no_order_id_in_metadata' };
  }


  if (event.type === 'checkout.session.completed') {
    // MP-A2-2: customer identity guard. session.customer must match profile cache for
    // (user_id, account_code). Mismatch → audit + manual_review on provider_events (caller),
    // do NOT silently rewrite the cache.
    const session_customer = (obj.customer as string | null) ?? null;
    const md_user_id = md.user_id ?? null;
    if (session_customer && md_user_id) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, meta')
        .eq('user_id', md_user_id)
        .maybeSingle();
      const cached = (prof?.meta as any)?.stripe?.customers?.[account_code]?.customer_id ?? null;
      if (cached && cached !== session_customer) {
        await supabase.from('audit_logs').insert({
          action: 'stripe_customer_mismatch_on_webhook',
          entity_type: 'orders_v2',
          entity_id: order_id_meta,
          meta: {
            user_id: md_user_id,
            account_code,
            profile_customer_id: cached,
            session_customer_id: session_customer,
            session_id: obj.id,
            manual_review: true,
          },
        });
        return { order_id: order_id_meta, note: 'customer_mismatch_manual_review' };
      }
      if (!cached && prof) {
        // No cache yet → record the session customer (sync, not merge).
        const meta = (prof.meta ?? {}) as Record<string, any>;
        const stripeMeta = (meta.stripe ?? {}) as Record<string, any>;
        const customers = (stripeMeta.customers ?? {}) as Record<string, any>;
        customers[account_code] = {
          ...(customers[account_code] ?? {}),
          customer_id: session_customer,
          last_synced_at: new Date().toISOString(),
          source: customers[account_code]?.source ?? 'stripe_webhook',
          created_at: customers[account_code]?.created_at ?? new Date().toISOString(),
        };
        stripeMeta.customers = customers;
        meta.stripe = stripeMeta;
        await supabase.from('profiles').update({ meta }).eq('id', prof.id);
      } else if (cached === session_customer && prof) {
        // Update last_synced_at only.
        const meta = (prof.meta ?? {}) as Record<string, any>;
        meta.stripe.customers[account_code].last_synced_at = new Date().toISOString();
        await supabase.from('profiles').update({ meta }).eq('id', prof.id);
      }
    }

    // PRR-FIX-02 (F4 + F2): sticky stripe meta + business_stream on order BEFORE grant.
    const md_business_stream = (md.business_stream as string | undefined) ?? null;
    const pi_id = (obj.payment_intent as string) ?? null;
    const session_id = obj.id as string;
    const md_payment_link_id = (md.payment_link_id as string | undefined) ?? null;
    await mergeStripeMetaOnOrder(supabase, order_id_meta, {
      checkout_session_id: session_id,
      payment_intent_id: pi_id,
      customer_id: session_customer,
      account_code,
      business_stream: md_business_stream,
      payment_link_id: md_payment_link_id,
    });

    // V2 fix-to-patch: atomic insert-winner FIRST. Downstream business lifecycle
    // (grant-access / transitionOrderPaid / CRM / payment_link consume /
    //  document materialize / card enrichment) runs ONLY on the winner branch.
    // Loser branch returns early — its sibling event already executed lifecycle.
    // When there is no pi_id (rare; mode!=payment, no PI generated), there is no
    // cross-event race possible, so lifecycle runs unconditionally.
    const amount_total_minor = Number(obj.amount_total ?? 0);
    const currency = String(obj.currency ?? 'usd').toUpperCase();
    const amount_major = toMajorUnits(amount_total_minor, currency);
    let payment_id: string | undefined;
    let inserted = false;
    if (pi_id) {
      const { data: ordRow } = await supabase
        .from('orders_v2')
        .select('user_id, profile_id')
        .eq('id', order_id_meta)
        .maybeSingle();
      const { payment_id: pid, inserted: ins } = await persistStripePaymentIfAbsent(supabase, pi_id, {
        order_id: order_id_meta,
        user_id: ordRow?.user_id ?? null,
        profile_id: ordRow?.profile_id ?? null,
        provider: 'stripe',
        provider_payment_id: pi_id,
        amount: amount_major,
        currency,
        status: 'succeeded',
        paid_at: new Date().toISOString(),
        meta: {
          business_stream: md_business_stream,
          stripe: { checkout_session_id: session_id, payment_intent_id: pi_id, account_code, customer: session_customer, business_stream: md_business_stream },
        },
      });
      payment_id = pid ?? undefined;
      inserted = ins;
    }

    // Cross-event lifecycle dedup: loser exits before grant-access / CRM / docs.
    if (pi_id && !inserted) {
      return { order_id: order_id_meta, payment_id, note: 'cross_event_loser_skipped:checkout' };
    }

    // Winner (or no-pi rare path): run full lifecycle exactly once.
    await supabase.functions.invoke('grant-access-for-order', {
      body: { order_id: order_id_meta, source: 'stripe_webhook', provider: 'stripe' },
    });
    if (inserted && payment_id) {
      notifyAdminPaymentEvent(supabase, {
        op: 'payment_succeeded',
        order_id: order_id_meta,
        payment_id,
        provider_object_id: pi_id,
        amount: amount_major,
        currency,
      });
    }
    await transitionOrderPaid(supabase, order_id_meta, amount_major, currency, pi_id ?? session_id);
    // PRR-FIX-02 (F3): apply CRM stage_on_success (winner only — prevents double audit).
    await applyCrmStageOnTerminal(supabase, order_id_meta, 'success', 'stripe.checkout.session.completed');

    // Phase 4.3: consume public payment_link slot (idempotent via helper).
    if (md_payment_link_id) {
      try {
        await consumePaymentLinkForOrder(
          supabase,
          order_id_meta,
          'stripe-webhook[checkout.session.completed]',
        );
      } catch (e) {
        await supabase.from('audit_logs').insert({
          action: 'stripe.payment_link.consume_failed',
          entity_type: 'orders_v2',
          entity_id: order_id_meta,
          meta: {
            error: e instanceof Error ? e.message : String(e),
            account_code,
            payment_link_id: md_payment_link_id,
            source: 'checkout.session.completed',
          },
        });
      }
    }
    // Phase 8-C: charge.receipt_url + card enrichment.
    try {
      if (payment_id && pi_id) {
        let sk: string | null = null;
        try { sk = await readAcquiringSecret('stripe', account_code, 'secret_key'); } catch { /* swallow */ }
        if (sk) {
          const resp = await fetch(
            `https://api.stripe.com/v1/payment_intents/${pi_id}?expand[]=latest_charge`,
            { headers: { Authorization: `Bearer ${sk}` } },
          );
          if (resp.ok) {
            const data = await resp.json();
            const latest = data?.latest_charge;
            const receipt_url = (latest && typeof latest === 'object') ? (latest.receipt_url ?? null) : null;
            await materializeStripeDocumentLinks(
              supabase,
              payment_id,
              { receipt_url },
              { event_id: event.id, event_type: event.type, account_code, source: 'checkout.session.completed.api_latest_charge' },
            );
            try {
              if (latest && typeof latest === 'object') {
                await enrichStripePaymentCardData({
                  supabase,
                  paymentId: payment_id,
                  paymentIntentId: pi_id,
                  accountCode: account_code,
                  source: 'checkout.session.completed',
                  actor: { type: 'system', label: 'Stripe webhook card enrichment' },
                  preloadedCharge: latest,
                  fetchStripeSecret: (code) => readAcquiringSecret('stripe', code, 'secret_key').catch(() => null),
                });
              }
            } catch { /* never re-throw */ }
          }
        }
      }
    } catch { /* never re-throw */ }
    return { order_id: order_id_meta, payment_id };
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi_id = obj.id as string;
    const amount_minor = Number(obj.amount_received ?? obj.amount ?? 0);
    const currency = String(obj.currency ?? 'usd').toUpperCase();
    const amount_major = toMajorUnits(amount_minor, currency);
    const md_business_stream = (md.business_stream as string | undefined) ?? null;
    const pi_customer = (obj.customer as string | null) ?? null;
    const charges = (obj.charges as { data?: Array<{ id: string }> } | undefined)?.data ?? [];
    const charge_id = charges[0]?.id ?? null;
    // PRR-FIX-02 (F4 + F2): sticky meta merge before downstream.
    await mergeStripeMetaOnOrder(supabase, order_id_meta, {
      payment_intent_id: pi_id,
      charge_id,
      customer_id: pi_customer,
      account_code,
      business_stream: md_business_stream,
    });
    // V2: atomic insert-winner via UNIQUE(provider, provider_payment_id).
    const { data: ordRow } = await supabase
      .from('orders_v2')
      .select('user_id, profile_id')
      .eq('id', order_id_meta)
      .maybeSingle();
    const { payment_id: pid, inserted } = await persistStripePaymentIfAbsent(supabase, pi_id, {
      order_id: order_id_meta,
      user_id: ordRow?.user_id ?? null,
      profile_id: ordRow?.profile_id ?? null,
      provider: 'stripe',
      provider_payment_id: pi_id,
      amount: amount_major,
      currency,
      status: 'succeeded',
      paid_at: new Date().toISOString(),
      meta: {
        business_stream: md_business_stream,
        stripe: { payment_intent_id: pi_id, charge_id, account_code, customer: pi_customer, business_stream: md_business_stream, source: 'payment_intent.succeeded' },
      },
    });
    const payment_id: string | undefined = pid ?? undefined;
    // PATCH-V2: notify ONLY when we were the atomic insert-winner.
    if (inserted && payment_id) {
      notifyAdminPaymentEvent(supabase, {
        op: 'payment_succeeded',
        order_id: order_id_meta,
        payment_id,
        provider_object_id: pi_id,
        amount: amount_major,
        currency,
      });
    }
    await transitionOrderPaid(supabase, order_id_meta, amount_major, currency, pi_id);
    // PRR-FIX-02 (F3): apply CRM stage_on_success (idempotent if already at target).
    await applyCrmStageOnTerminal(supabase, order_id_meta, 'success', 'stripe.payment_intent.succeeded');
    // Phase 8-C: materialize one-time charge.receipt_url via Stripe API (latest_charge).
    // Strictly non-fatal: never affects webhook lifecycle. Lineage = pi_id only.
    try {
      if (payment_id && pi_id) {
        let sk: string | null = null;
        try { sk = await readAcquiringSecret('stripe', account_code, 'secret_key'); } catch { /* swallow */ }
        if (sk) {
          const resp = await fetch(
            `https://api.stripe.com/v1/payment_intents/${pi_id}?expand[]=latest_charge`,
            { headers: { Authorization: `Bearer ${sk}` } },
          );
          if (resp.ok) {
            const data = await resp.json();
            const latest = data?.latest_charge;
            const receipt_url = (latest && typeof latest === 'object') ? (latest.receipt_url ?? null) : null;
            await materializeStripeDocumentLinks(
              supabase,
              payment_id,
              { receipt_url },
              { event_id: event.id, event_type: event.type, account_code, source: 'pi.succeeded.api_latest_charge' },
            );
            // PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2: единый writer card snapshot.
            try {
              if (payment_id && pi_id && latest && typeof latest === 'object') {
                await enrichStripePaymentCardData({
                  supabase,
                  paymentId: payment_id,
                  paymentIntentId: pi_id,
                  accountCode: account_code,
                  source: 'payment_intent.succeeded',
                  actor: { type: 'system', label: 'Stripe webhook card enrichment' },
                  preloadedCharge: latest,
                  fetchStripeSecret: (code) => readAcquiringSecret('stripe', code, 'secret_key').catch(() => null),
                });
              }
            } catch { /* never re-throw — webhook lifecycle must not fail */ }

          }
        }
      }
    } catch { /* never re-throw */ }
    return { order_id: order_id_meta, payment_id };
  }


  if (event.type === 'payment_intent.payment_failed') {
    await supabase.from('audit_logs').insert({
      action: 'stripe.payment_intent.payment_failed',
      entity_type: 'orders_v2',
      entity_id: order_id_meta,
      meta: {
        payment_intent: obj.id,
        last_payment_error: obj.last_payment_error ?? null,
        account_code,
      },
    });
    // PRR-FIX-02 (F3): apply CRM stage_on_failed.
    await applyCrmStageOnTerminal(supabase, order_id_meta, 'failed', 'stripe.payment_intent.payment_failed');
    return { order_id: order_id_meta, note: 'logged' };
  }

  if (event.type === 'charge.refunded' || event.type === 'refund.created' || event.type === 'refund.updated') {
    // PATCH-V2: collect ALL refunds (not just data[0]) so that multiple partial
    // refunds within a single charge.refunded delivery are each processed and
    // notified exactly once (per re_*). The RPC `record_refund_atomic_multi`
    // returns `{idempotent: bool}` per refund_uid — that's the SOT for notify gate.
    const refunds: Array<{ id: string; amount: number; currency: string; reason?: string | null; created?: number | null }> = [];
    let pi_id: string | null = null;
    let charge_id: string | null = null;

    if (event.type === 'charge.refunded') {
      charge_id = (obj as { id?: string }).id ?? null;
      pi_id = (obj as { payment_intent?: string }).payment_intent ?? null;
      const inlineList = (obj.refunds as { data?: Array<{ id: string; amount: number; currency: string; reason?: string | null; created?: number }> } | undefined)?.data ?? [];
      if (inlineList.length > 0) {
        for (const r of inlineList) {
          if (r?.id && typeof r.amount === 'number' && r.currency) {
            refunds.push({ id: r.id, amount: r.amount, currency: r.currency, reason: r.reason ?? null, created: r.created ?? null });
          }
        }
      } else if (charge_id) {
        // Stripe API >= 2024: refunds.data not embedded — fetch via API.
        let sk: string | null = null;
        try { sk = await readAcquiringSecret('stripe', account_code, 'secret_key'); }
        catch (e) {
          await supabase.from('audit_logs').insert({
            action: 'stripe.refund.secret_lookup_failed',
            entity_type: 'orders_v2', entity_id: order_id_meta,
            meta: { account_code, error: e instanceof Error ? e.message : String(e) },
          });
        }
        if (sk) {
          const resp = await fetch(`https://api.stripe.com/v1/charges/${charge_id}?expand[]=refunds`, {
            headers: { 'Authorization': `Bearer ${sk}` },
          });
          const data = await resp.json();
          const list = data?.refunds?.data ?? [];
          for (const r of list) {
            if (r?.id && typeof r.amount === 'number' && r.currency) {
              refunds.push({ id: r.id, amount: r.amount, currency: r.currency, reason: r.reason ?? null, created: r.created ?? null });
            }
          }
          if (refunds.length === 0) {
            await supabase.from('audit_logs').insert({
              action: 'stripe.refund.api_fetch_no_refund',
              entity_type: 'orders_v2', entity_id: order_id_meta,
              meta: { charge_id, api_status: resp.status, api_data_summary: { has_refunds: !!data?.refunds, count: list.length } },
            });
          }
          if (!pi_id && data?.payment_intent) pi_id = data.payment_intent;
        }
      }
    } else {
      // refund.created / refund.updated → obj IS the refund. NOT a notify trigger,
      // but still routed through RPC for ledger idempotency.
      const r = obj as { id?: string; amount?: number; currency?: string; reason?: string | null; payment_intent?: string; charge?: string; status?: string; created?: number };
      if (r.status && r.status !== 'succeeded') {
        return { order_id: order_id_meta, note: `refund_skip_status_${r.status}` };
      }
      if (r.id && typeof r.amount === 'number' && r.currency) {
        refunds.push({ id: r.id, amount: r.amount, currency: r.currency, reason: r.reason ?? null, created: r.created ?? null });
        pi_id = r.payment_intent ?? null;
        charge_id = r.charge ?? null;
      }
    }

    if (refunds.length === 0) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.refund.no_data',
        entity_type: 'orders_v2', entity_id: order_id_meta,
        meta: { event_type: event.type, charge_id, pi_id, account_code },
      });
      return { order_id: order_id_meta, note: 'refund_no_data' };
    }

    let parent_payment_id: string | null = null;
    if (pi_id) {
      const { data: parent } = await supabase
        .from('payments_v2')
        .select('id')
        .eq('provider', 'stripe')
        .eq('provider_payment_id', pi_id)
        .maybeSingle();
      parent_payment_id = parent?.id ?? null;
    }
    if (!parent_payment_id) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.refund.parent_payment_not_found',
        entity_type: 'orders_v2', entity_id: order_id_meta,
        meta: { refund_ids: refunds.map(r => r.id), payment_intent: pi_id, charge_id, account_code },
      });
      return { order_id: order_id_meta, note: 'refund_parent_not_found' };
    }

    // PATCH-V2: process refunds in stable order (oldest first), notify ONLY for
    // those where the atomic RPC reports `idempotent: false` (new insert).
    const ordered = orderedRefundCandidates(refunds as ReadonlyArray<RefundRecord>);
    const results: Array<{ refund_id: string; inserted: boolean; error?: string }> = [];
    for (const refund of ordered) {
      const refund_currency = refund.currency.toUpperCase();
      const { data: rpcData, error: rpcErr } = await supabase.rpc('record_refund_atomic_multi', {
        p_order_id: order_id_meta,
        p_parent_payment_id: parent_payment_id,
        p_refund_amount: toMajorUnits(Number(refund.amount), refund_currency),
        p_refund_uid: refund.id,
        p_provider: 'stripe',
        p_refund_reason: refund.reason ?? 'stripe_refund',
        p_actor_user_id: null,
        p_target_user_id: null,
        p_provider_response: { stripe: { charge_id, payment_intent: pi_id, account_code, event_type: event.type, refund } },
        p_meta_extra: {},
      });
      if (rpcErr) {
        await supabase.from('audit_logs').insert({
          action: 'stripe.refund.record_failed',
          entity_type: 'orders_v2', entity_id: order_id_meta,
          meta: { error: rpcErr.message, refund_id: refund.id, parent_payment_id },
        });
        results.push({ refund_id: refund.id, inserted: false, error: rpcErr.message });
        continue;
      }
      const rpcObj = (rpcData ?? {}) as { idempotent?: boolean };
      const inserted = rpcObj.idempotent === false;
      results.push({ refund_id: refund.id, inserted });

      // PATCH-V2: notify ONLY for `charge.refunded` AND only when RPC inserted a new row.
      if (event.type === 'charge.refunded' && inserted) {
        notifyAdminPaymentEvent(supabase, {
          op: 'refund_succeeded',
          order_id: order_id_meta,
          payment_id: parent_payment_id,
          provider_object_id: refund.id,
          amount: toMajorUnits(Number(refund.amount), refund_currency),
          currency: refund_currency,
        });
      }
    }

    // Phase 8-C: materialize parent receipt_url (COALESCE — never overwrites).
    if (event.type === 'charge.refunded') {
      const rcpt = (obj as { receipt_url?: string | null }).receipt_url ?? null;
      await materializeStripeDocumentLinks(
        supabase,
        parent_payment_id,
        { receipt_url: rcpt },
        { event_id: event.id, event_type: event.type, account_code, source: 'charge.refunded.payload' },
      );
    }
    return { order_id: order_id_meta, note: 'refund_recorded', rpc: { processed: results.length, results } };
  }



  if (event.type === 'checkout.session.expired') {
    await supabase.from('audit_logs').insert({
      action: 'stripe.checkout.session.expired',
      entity_type: 'orders_v2',
      entity_id: order_id_meta,
      meta: { session_id: obj.id, account_code },
    });
    return { order_id: order_id_meta, note: 'expired' };
  }

  if (event.type === 'charge.dispute.created') {
    return { order_id: order_id_meta, note: 'dispute_logged_only' };
  }

  return { order_id: order_id_meta, note: 'no_handler_phase_2' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405, headers: corsHeaders });
  }
  // RAW body — DO NOT parse JSON before signature check.
  const rawBody = await req.text();
  const sigHeader = req.headers.get('Stripe-Signature');

  const supabase = svc();
  // Try each active stripe connection's webhook secret. In MVP usually one.
  const { data: conns } = await supabase
    .from('acquiring_connections')
    .select('account_code, status, test_mode')
    .eq('provider', 'stripe')
    .in('status', ['active', 'pending', 'invalid']);

  let verifiedAccount: string | null = null;
  for (const c of conns ?? []) {
    let secret: string;
    try {
      secret = await readAcquiringSecret('stripe', c.account_code, 'webhook_signing_secret');
    } catch {
      continue;
    }
    const v = await verifyStripeSignature(rawBody, sigHeader, secret);
    if (v.valid) {
      verifiedAccount = c.account_code;
      break;
    }
  }

  if (!verifiedAccount) {
    return new Response(JSON.stringify({ ok: false, error: 'signature_verification_failed' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return new Response('invalid_json', { status: 400, headers: corsHeaders });
  }

  const idempotency_key = `stripe:${verifiedAccount}:${event.id}`;
  const md = ((event.data?.object as Record<string, unknown>)?.metadata ?? {}) as Record<string, string>;
  const meta_account_code = md.account_code;
  const initial_status =
    meta_account_code && meta_account_code !== verifiedAccount ? 'manual_review' : 'received';

  const { data: inserted, error: insErr } = await supabase
    .from('provider_events')
    .insert({
      provider: 'stripe',
      account_code: verifiedAccount,
      event_id: event.id,
      event_type: event.type,
      idempotency_key,
      payload: event as unknown as Record<string, unknown>,
      signature_valid: true,
      processing_status: initial_status,
    })
    .select('id')
    .maybeSingle();

  if (insErr && insErr.code === '23505') {
    return new Response(JSON.stringify({ ok: true, status: 'skipped_duplicate' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (insErr || !inserted) {
    return new Response(JSON.stringify({ ok: false, error: insErr?.message ?? 'insert_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (initial_status === 'manual_review') {
    return new Response(JSON.stringify({ ok: true, status: 'manual_review' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const out = await dispatch(event, verifiedAccount);
    // manual_review triggers:
    //   - Phase 2: 'customer_mismatch_manual_review'
    //   - Phase 3.1 Stage 2: 'manual_review:<reason>' (resolver-driven)
    const isManual =
      out.note === 'customer_mismatch_manual_review' ||
      (typeof out.note === 'string' && out.note.startsWith('manual_review:'));
    const status = isManual ? 'manual_review' : 'processed';
    await supabase
      .from('provider_events')
      .update({
        processed_at: new Date().toISOString(),
        processing_status: status,
        related_order_id: out.order_id ?? null,
        related_payment_id: out.payment_id ?? null,
        processing_error: status === 'manual_review' ? (out.note ?? 'manual_review') : null,
      })
      .eq('id', inserted.id);
    return new Response(JSON.stringify({ ok: true, status, ...out }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'dispatch_error';
    await supabase
      .from('provider_events')
      .update({
        processed_at: new Date().toISOString(),
        processing_status: 'failed',
        processing_error: msg,
      })
      .eq('id', inserted.id);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, // Return 200 so Stripe doesn't retry indefinitely; we have audit
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
