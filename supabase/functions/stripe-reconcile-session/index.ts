// Phase 2.1 — stripe-reconcile-session
// super_admin only. For a given order_id (or session_id), pulls the canonical
// state from Stripe and runs the SAME side-effects the webhook would, idempotently.
//
// Uses provider_events with idempotency_key = `stripe:{account}:{event_id}` style;
// for reconcile we use `stripe:{account}:reconcile:{session_id}` so it does not
// collide with real webhook events. payments_v2 dedupe is by provider_payment_id.

import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeGetCheckoutSession } from '../_shared/acquiring/stripe-client.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

function svc() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    await requireSuperAdmin(req);
    const body = (await req.json().catch(() => ({}))) as {
      order_id?: string;
      session_id?: string;
      account_code?: string;
    };
    const code = body.account_code ?? 'stripe_poland';
    const supabase = svc();

    // Resolve session_id from order_id if needed
    let session_id = body.session_id ?? null;
    let order_id = body.order_id ?? null;
    if (!session_id && order_id) {
      const { data: ord } = await supabase
        .from('orders_v2')
        .select('provider_payment_id, status')
        .eq('id', order_id)
        .maybeSingle();
      if (!ord) return jsonResponse({ ok: false, error: 'order_not_found' });
      session_id = (ord.provider_payment_id as string) ?? null;
    }
    if (!session_id) return jsonResponse({ ok: false, error: 'missing_session_id_or_order_id' });

    const sk = await readAcquiringSecret('stripe', code, 'secret_key');
    const res = await stripeGetCheckoutSession(sk, session_id);
    if (!res.ok) return jsonResponse({ ok: false, step: 'stripe_get_session', error: res.error });
    const s = res.data as Record<string, unknown>;

    const session_status = String(s.status ?? '');
    const payment_status = String(s.payment_status ?? '');
    const pi_id = (s.payment_intent as string) ?? null;
    const amount_total = Number(s.amount_total ?? 0);
    const currency = String(s.currency ?? 'usd').toUpperCase();
    const md = (s.metadata ?? {}) as Record<string, string>;
    order_id = order_id ?? md.order_id ?? (s.client_reference_id as string | undefined) ?? null;

    if (!order_id) return jsonResponse({ ok: false, error: 'no_order_id_in_metadata' });

    const isPaid = session_status === 'complete' && payment_status === 'paid';
    if (!isPaid) {
      return jsonResponse({
        ok: true,
        action: 'noop',
        reason: 'session_not_paid',
        session_status,
        payment_status,
        order_id,
      });
    }

    // 1) Idempotent provider_events row for reconcile
    const idem = `stripe:${code}:reconcile:${session_id}`;
    const { data: existingEv } = await supabase
      .from('provider_events')
      .select('id, processing_status')
      .eq('idempotency_key', idem)
      .maybeSingle();

    let ev_id = existingEv?.id ?? null;
    let alreadyProcessed = existingEv?.processing_status === 'processed';

    if (!ev_id) {
      const { data: ins, error: insErr } = await supabase
        .from('provider_events')
        .insert({
          provider: 'stripe',
          account_code: code,
          event_id: `reconcile_${session_id}`,
          event_type: 'checkout.session.completed.reconcile',
          idempotency_key: idem,
          payload: s as unknown as Record<string, unknown>,
          signature_valid: true,
          processing_status: 'received',
        })
        .select('id')
        .maybeSingle();
      if (insErr) return jsonResponse({ ok: false, step: 'provider_events_insert', error: insErr.message });
      ev_id = ins?.id ?? null;
    }

    // 2) payments_v2 dedupe by provider_payment_id
    let payment_id: string | null = null;
    let payment_action: 'created' | 'existing' | 'skipped_no_pi' = 'skipped_no_pi';
    if (pi_id) {
      const { data: existingPay } = await supabase
        .from('payments_v2')
        .select('id')
        .eq('provider_payment_id', pi_id)
        .maybeSingle();
      if (existingPay) {
        payment_id = existingPay.id;
        payment_action = 'existing';
      } else {
        const { data: insPay, error: payErr } = await supabase
          .from('payments_v2')
          .insert({
            order_id,
            provider: 'stripe',
            provider_payment_id: pi_id,
            amount: amount_total,
            currency,
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            meta: {
              stripe: { checkout_session_id: session_id, account_code: code, source: 'reconcile' },
            },
          })
          .select('id')
          .maybeSingle();
        if (payErr) return jsonResponse({ ok: false, step: 'payments_v2_insert', error: payErr.message });
        payment_id = insPay?.id ?? null;
        payment_action = 'created';
      }
    }

    // 3) Call grant-access-for-order (canonical write-path).
    //     For sandbox manual orders without product/tariff, grant-access will no-op or 500.
    //     The order itself must still transition to paid because Stripe says paid.
    const { error: grantErr } = await supabase.functions.invoke('grant-access-for-order', {
      body: { order_id, source: 'stripe_reconcile', provider: 'stripe' },
    });
    const grant_ok = !grantErr;

    // 3b) Ensure orders_v2 status = 'paid' (idempotent, sandbox-safe)
    const { data: ordRow } = await supabase
      .from('orders_v2')
      .select('status, meta')
      .eq('id', order_id)
      .maybeSingle();
    let order_status_updated = false;
    if (ordRow && ordRow.status !== 'paid') {
      const mergedMeta = {
        ...(ordRow.meta ?? {}),
        stripe_reconcile: { session_id, payment_intent: pi_id, at: new Date().toISOString() },
      };
      const { error: updErr } = await supabase
        .from('orders_v2')
        .update({ status: 'paid', paid_at: new Date().toISOString(), meta: mergedMeta })
        .eq('id', order_id);
      order_status_updated = !updErr;
    }


    // 4) Mark event processed
    if (ev_id) {
      await supabase
        .from('provider_events')
        .update({
          processed_at: new Date().toISOString(),
          processing_status: 'processed',
          related_order_id: order_id,
          related_payment_id: payment_id,
          processing_error: grant_ok ? null : (grantErr?.message ?? null),
        })
        .eq('id', ev_id);
    }

    return jsonResponse({
      ok: true,
      action: alreadyProcessed ? 'reprocessed' : 'processed',
      order_id,
      session_id,
      payment_intent: pi_id,
      payment_id,
      payment_action,
      grant_ok,
      grant_error: grantErr?.message ?? null,
      provider_event_id: ev_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
