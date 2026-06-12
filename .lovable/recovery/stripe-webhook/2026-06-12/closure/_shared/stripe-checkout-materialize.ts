// PATCH: Stripe subscription checkout materialization (recovery / safety path).
//
// Назначение: восстановить бизнес-данные подписочного Stripe Checkout, если
// `invoice.paid` не пришёл, но `checkout.session.completed` уже произошёл и оплата паидна.
//
// Канонический lifecycle подписок остаётся `invoice.paid` (см. stripe-subscription-resolver).
// Этот helper НЕ вводит второй write-path: он подтягивает реальный invoice из Stripe API
// и вызывает существующий `onInvoicePaid()`, который сам делает SELECT-before-INSERT
// по `orders_v2.meta->stripe->>invoice_id`. Если позже придёт настоящий `invoice.paid` —
// он увидит already materialized и не создаст дубль.
//
// STRICT GUARDS:
//   session.mode = subscription
//   session.status = complete
//   session.payment_status = paid
//   session.subscription starts with 'sub_'
//   metadata.subscription_v2_id exists
//   metadata.provider_subscription_row_id exists
//   metadata.payment_link_id exists
//   metadata.account_code (если есть) matches resolved account_code
//
// При mismatch → audit + manual_review; никаких INSERT.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { readAcquiringSecret } from './acquiring/vault.ts';
import { onInvoicePaid, type StripeEvent, type ResolveResult } from './stripe-subscription-resolver.ts';

type SupabaseClient = ReturnType<typeof createClient>;

export interface ActivateCheckoutInput {
  session: Record<string, unknown>;
  account_code: string;
  /** Source event ID (real checkout.session.completed event id, or reconcile-synthetic id). */
  source_event_id: string;
  /** 'stripe.webhook.checkout.session.completed' | 'stripe.reconcile.session' */
  source: string;
}

export interface ActivateCheckoutResult extends ResolveResult {
  skipped?: string;
}

async function audit(
  supabase: SupabaseClient,
  action: string,
  result: string,
  extra: Record<string, unknown>,
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action,
    actor_type: 'system',
    actor_label: 'stripe-checkout-materialize',
    entity_type: 'provider_events',
    entity_id: null,
    meta: { result, ...extra },
  });
}

export async function activateStripeSubscriptionCheckout(
  supabase: SupabaseClient,
  input: ActivateCheckoutInput,
): Promise<ActivateCheckoutResult> {
  const { session, account_code, source_event_id, source } = input;

  // ---- Guard: mode ----
  const mode = String(session.mode ?? '');
  if (mode !== 'subscription') {
    return { skipped: 'not_subscription_mode' };
  }

  const session_id = String(session.id ?? '');
  const session_status = String(session.status ?? '');
  const payment_status = String(session.payment_status ?? '');
  const stripeSubId = (session.subscription as string | null) ?? null;
  const invoice_from_session = (session.invoice as string | null) ?? null;
  const md = (session.metadata ?? {}) as Record<string, string>;

  // ---- Guards: completed + paid + sub_ + metadata ----
  if (session_status !== 'complete' || payment_status !== 'paid') {
    return { skipped: `session_not_paid:${session_status}/${payment_status}` };
  }
  if (!stripeSubId || !stripeSubId.startsWith('sub_')) {
    await audit(supabase, 'stripe.checkout.materialize.no_subscription', 'manual_review', {
      session_id, account_code, source, source_event_id,
    });
    return { skipped: 'no_subscription_id', manual_review: true };
  }
  const subv2_id = md.subscription_v2_id ?? null;
  const provider_subscription_row_id = md.provider_subscription_row_id ?? null;
  const payment_link_id = md.payment_link_id ?? null;
  if (!subv2_id || !provider_subscription_row_id || !payment_link_id) {
    await audit(supabase, 'stripe.checkout.materialize.metadata_incomplete', 'manual_review', {
      session_id, account_code, source, source_event_id,
      has_subv2_id: !!subv2_id,
      has_provider_subscription_row_id: !!provider_subscription_row_id,
      has_payment_link_id: !!payment_link_id,
    });
    return { skipped: 'metadata_incomplete', manual_review: true };
  }
  if (md.account_code && md.account_code !== account_code) {
    await audit(supabase, 'stripe.checkout.materialize.account_code_mismatch', 'manual_review', {
      session_id, account_code, metadata_account_code: md.account_code, source, source_event_id,
    });
    return { skipped: 'account_code_mismatch', manual_review: true };
  }

  // ---- Fast-path idempotency: invoice already materialized? ----
  // If we already have invoice_id from session AND an order rooted in it — short-circuit.
  if (invoice_from_session) {
    const { data: existingOrders } = await supabase
      .from('orders_v2')
      .select('id')
      .filter('meta->stripe->>invoice_id', 'eq', invoice_from_session)
      .limit(1);
    if (existingOrders && existingOrders.length > 0) {
      return {
        order_id: (existingOrders[0] as any).id,
        note: 'already_materialized_by_invoice',
      };
    }
  }
  // Also check by checkout_session_id (cheap, covers cases where invoice_id was not set yet).
  {
    const { data: existingOrders } = await supabase
      .from('orders_v2')
      .select('id')
      .filter('meta->stripe->>checkout_session_id', 'eq', session_id)
      .limit(1);
    if (existingOrders && existingOrders.length > 0) {
      return {
        order_id: (existingOrders[0] as any).id,
        note: 'already_materialized_by_session',
      };
    }
  }

  // ---- Resolve invoice id ----
  let invoice_id = invoice_from_session;
  if (!invoice_id) {
    // Pull invoice id from the subscription via Stripe API (latest_invoice).
    try {
      const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
      const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
        headers: { Authorization: `Bearer ${sk}` },
      });
      if (resp.ok) {
        const subObj = await resp.json();
        invoice_id = (subObj?.latest_invoice as string | null) ?? null;
      }
    } catch (e) {
      await audit(supabase, 'stripe.checkout.materialize.subscription_api_lookup_failed', 'manual_review', {
        session_id, account_code, source, source_event_id,
        error: e instanceof Error ? e.message : String(e),
      });
      return { skipped: 'subscription_api_lookup_failed', manual_review: true };
    }
  }
  if (!invoice_id) {
    await audit(supabase, 'stripe.checkout.materialize.no_invoice_id', 'manual_review', {
      session_id, account_code, source, source_event_id, subscription_id: stripeSubId,
    });
    return { skipped: 'no_invoice_id', manual_review: true };
  }

  // ---- Fetch the real invoice object from Stripe API ----
  let invoiceObj: Record<string, unknown> | null = null;
  try {
    const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
    const resp = await fetch(
      `https://api.stripe.com/v1/invoices/${encodeURIComponent(invoice_id)}`,
      { headers: { Authorization: `Bearer ${sk}` } },
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      await audit(supabase, 'stripe.checkout.materialize.invoice_fetch_failed', 'manual_review', {
        session_id, account_code, source, source_event_id, invoice_id,
        status: resp.status, body: txt.slice(0, 500),
      });
      return { skipped: 'invoice_fetch_failed', manual_review: true };
    }
    invoiceObj = await resp.json();
  } catch (e) {
    await audit(supabase, 'stripe.checkout.materialize.invoice_fetch_error', 'manual_review', {
      session_id, account_code, source, source_event_id, invoice_id,
      error: e instanceof Error ? e.message : String(e),
    });
    return { skipped: 'invoice_fetch_error', manual_review: true };
  }

  if (!invoiceObj) {
    return { skipped: 'invoice_empty', manual_review: true };
  }

  // Ensure invoice.subscription is populated (older API versions) or trust parent.subscription_details.
  if (!invoiceObj.subscription) {
    (invoiceObj as any).subscription = stripeSubId;
  }

  // ---- Synthesize invoice.paid event and reuse the canonical resolver ----
  const syntheticEvent: StripeEvent = {
    id: `synthetic_from_checkout:${source_event_id}`,
    type: 'invoice.paid',
    data: { object: invoiceObj },
    livemode: true,
  };

  const result = await onInvoicePaid(supabase, syntheticEvent, account_code);

  await audit(supabase, 'stripe.checkout.materialize.delegated_to_invoice_paid', 'ok', {
    session_id, account_code, source, source_event_id,
    subscription_id: stripeSubId, invoice_id,
    order_id: result.order_id ?? null,
    payment_id: result.payment_id ?? null,
    note: result.note ?? null,
    manual_review: result.manual_review ?? false,
    manual_review_reason: result.manual_review_reason ?? null,
  });

  return result;
}
