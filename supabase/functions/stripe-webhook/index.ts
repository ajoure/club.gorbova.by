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


async function dispatch(event: StripeEvent, account_code: string): Promise<{ order_id?: string; payment_id?: string; note?: string }> {
  const supabase = svc();
  const obj = event.data.object as Record<string, unknown>;
  const md = (obj.metadata ?? {}) as Record<string, string>;
  const meta_account_code = md.account_code;
  const order_id_meta = md.order_id ?? (obj.client_reference_id as string | undefined);


  // Cross-check resolved (from webhook secret) vs metadata account_code
  if (meta_account_code && meta_account_code !== account_code) {
    return { note: 'account_code_mismatch' };
  }
  if (!order_id_meta) {
    return { note: 'no_order_id_in_metadata' };
  }

  if (event.type === 'checkout.session.completed') {
    // Find order; call grant-access-for-order (existing, untouched).
    await supabase.functions.invoke('grant-access-for-order', {
      body: { order_id: order_id_meta, source: 'stripe_webhook', provider: 'stripe' },
    });
    // Insert payments_v2 if not exists
    const pi_id = (obj.payment_intent as string) ?? null;
    const session_id = obj.id as string;
    const amount_total_minor = Number(obj.amount_total ?? 0);
    const currency = String(obj.currency ?? 'usd').toUpperCase();
    const amount_major = toMajorUnits(amount_total_minor, currency);
    let payment_id: string | undefined;
    if (pi_id) {
      const { data: existing } = await supabase
        .from('payments_v2')
        .select('id')
        .eq('provider_payment_id', pi_id)
        .maybeSingle();
      if (!existing) {
        const { data: ins } = await supabase
          .from('payments_v2')
          .insert({
            order_id: order_id_meta,
            provider: 'stripe',
            provider_payment_id: pi_id,
            amount: amount_major,
            currency,
            status: 'succeeded',
            paid_at: new Date().toISOString(),
            meta: { stripe: { checkout_session_id: session_id, account_code } },
          })
          .select('id')
          .maybeSingle();
        payment_id = ins?.id;
      } else {
        payment_id = existing.id;
      }
    }
    await transitionOrderPaid(supabase, order_id_meta, amount_major, currency, pi_id ?? session_id);
    return { order_id: order_id_meta, payment_id };
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi_id = obj.id as string;
    const amount_minor = Number(obj.amount_received ?? obj.amount ?? 0);
    const currency = String(obj.currency ?? 'usd').toUpperCase();
    const amount_major = toMajorUnits(amount_minor, currency);
    const { data: existing } = await supabase
      .from('payments_v2')
      .select('id')
      .eq('provider_payment_id', pi_id)
      .maybeSingle();
    let payment_id: string | undefined;
    if (existing) {
      payment_id = existing.id;
    } else {
      const charges = (obj.charges as { data?: Array<{ id: string }> } | undefined)?.data ?? [];
      const charge_id = charges[0]?.id ?? null;
      const { data: ins } = await supabase
        .from('payments_v2')
        .insert({
          order_id: order_id_meta,
          provider: 'stripe',
          provider_payment_id: pi_id,
          amount: amount_major,
          currency,
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          meta: { stripe: { charge_id, account_code, source: 'payment_intent.succeeded' } },
        })
        .select('id')
        .maybeSingle();
      payment_id = ins?.id;
    }
    await transitionOrderPaid(supabase, order_id_meta, amount_major, currency, pi_id);
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
    return { order_id: order_id_meta, note: 'logged' };
  }

  if (event.type === 'charge.refunded' || event.type === 'refund.created' || event.type === 'refund.updated') {
    let refund: { id: string; amount: number; currency: string; reason?: string | null; payment_intent?: string; charge?: string } | null = null;
    let pi_id: string | null = null;
    let charge_id: string | null = null;

    if (event.type === 'charge.refunded') {
      charge_id = (obj as { id?: string }).id ?? null;
      pi_id = (obj as { payment_intent?: string }).payment_intent ?? null;
      const inline = (obj.refunds as { data?: Array<{ id: string; amount: number; currency: string; reason?: string | null }> } | undefined)?.data?.[0];
      if (inline) {
        refund = { ...inline, payment_intent: pi_id ?? undefined, charge: charge_id ?? undefined };
      } else if (charge_id) {
        // Stripe (API >= 2024) no longer embeds refunds.data in charge.refunded payload. Fetch via API.
        const sk = await readAcquiringSecret('stripe', account_code, 'secret_key').catch(() => null);
        if (sk) {
          const resp = await fetch(`https://api.stripe.com/v1/charges/${charge_id}?expand[]=refunds`, {
            headers: { 'Authorization': `Bearer ${sk}` },
          });
          const data = await resp.json();
          const r = data?.refunds?.data?.[0];
          if (r) refund = { id: r.id, amount: r.amount, currency: r.currency, reason: r.reason, payment_intent: data?.payment_intent ?? pi_id ?? undefined, charge: charge_id };
        }
      }
    } else {
      // refund.created / refund.updated → obj IS the refund
      const r = obj as { id?: string; amount?: number; currency?: string; reason?: string | null; payment_intent?: string; charge?: string; status?: string };
      if (r.status && r.status !== 'succeeded') {
        return { order_id: order_id_meta, note: `refund_skip_status_${r.status}` };
      }
      if (r.id && typeof r.amount === 'number' && r.currency) {
        refund = { id: r.id, amount: r.amount, currency: r.currency, reason: r.reason ?? null, payment_intent: r.payment_intent, charge: r.charge };
        pi_id = r.payment_intent ?? null;
        charge_id = r.charge ?? null;
      }
    }

    if (!refund) return { order_id: order_id_meta, note: 'refund_no_data' };

    const refund_currency = refund.currency.toUpperCase();
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
        entity_type: 'orders_v2',
        entity_id: order_id_meta,
        meta: { refund_id: refund.id, payment_intent: pi_id, charge_id, account_code },
      });
      return { order_id: order_id_meta, note: 'refund_parent_not_found' };
    }
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
        entity_type: 'orders_v2',
        entity_id: order_id_meta,
        meta: { error: rpcErr.message, refund_id: refund.id, parent_payment_id },
      });
      return { order_id: order_id_meta, note: 'refund_record_failed', error: rpcErr.message };
    }
    return { order_id: order_id_meta, note: 'refund_recorded', rpc: rpcData };
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
    await supabase
      .from('provider_events')
      .update({
        processed_at: new Date().toISOString(),
        processing_status: 'processed',
        related_order_id: out.order_id ?? null,
        related_payment_id: out.payment_id ?? null,
      })
      .eq('id', inserted.id);
    return new Response(JSON.stringify({ ok: true, status: 'processed', ...out }), {
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
