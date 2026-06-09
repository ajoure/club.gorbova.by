// admin-stripe-repair-refund-recording — Stripe-aware mirror of
// admin-repair-refund-recording (bePaid). Recovers refund records when a
// Stripe refund actually happened on Stripe's side (Dashboard / API / earlier
// failed delivery) but the local DB never got the webhook (`charge.refunded`).
//
// Rules:
//  - super_admin OR service_role only (no service_role bypass from public)
//  - NEVER creates a refund on Stripe — only reads
//  - Verifies refund object is real, status='succeeded', livemode=true
//  - Writes via canonical RPC `record_refund_atomic_multi` (idempotent by refund_uid)
//  - Does NOT touch access / entitlements (admin decision)
//  - Provider scope: 'stripe' only

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

interface Body {
  payment_intent?: string;            // pi_*
  refund_id?: string;                 // optional — verify only this refund
  account_code?: string;              // defaults to value found on payments_v2.meta
  dry_run?: boolean;
}

interface StripeRefund {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  payment_intent?: string;
  charge?: string;
  livemode?: boolean;
  created?: number;
}

function toMajor(amountMinor: number, currency: string): number {
  const zeroDecimal = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);
  const div = zeroDecimal.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round((amountMinor / div) * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    const cronSecretHeader = req.headers.get('x-cron-secret') ?? '';
    const cronSecretEnv = Deno.env.get('CRON_SECRET') ?? '';

    // Allow super_admin JWT OR service_role OR explicit CRON_SECRET (server-only invocation by ops).
    let actorUserId: string | null = null;
    let actorLabel = 'admin-stripe-repair-refund-recording';
    const usingCronSecret = cronSecretEnv && cronSecretHeader && cronSecretHeader === cronSecretEnv;
    if (usingCronSecret) {
      actorLabel = 'ops:cron-secret:admin-stripe-repair-refund-recording';
    } else if (token && token === serviceKey) {
      actorLabel = 'service-role:admin-stripe-repair-refund-recording';
    } else if (token) {
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: u, error: ue } = await authClient.auth.getUser(token);
      if (ue || !u?.user) return errorResponse('unauthorized: invalid jwt', 401);
      actorUserId = u.user.id;
      const supa = createClient(supabaseUrl, serviceKey);
      const { data: isSuper } = await supa.rpc('has_role_v2', {
        _user_id: actorUserId, _role_code: 'super_admin',
      });
      if (!isSuper) return errorResponse('forbidden: super_admin required', 403);
    } else {
      return errorResponse('unauthorized: missing bearer or x-cron-secret', 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.payment_intent || !/^pi_[A-Za-z0-9]+$/.test(body.payment_intent)) {
      return errorResponse('invalid_payment_intent', 400);
    }

    // 1) Find parent payment row in DB.
    const { data: parent, error: parentErr } = await supabase
      .from('payments_v2')
      .select('id, order_id, user_id, profile_id, amount, currency, status, meta, refunded_amount')
      .eq('provider', 'stripe')
      .eq('provider_payment_id', body.payment_intent)
      .maybeSingle();
    if (parentErr) return errorResponse(`db_lookup_failed:${parentErr.message}`, 500);
    if (!parent) return errorResponse('parent_payment_not_found_in_db', 404);

    const account_code =
      body.account_code ??
      (parent.meta as any)?.stripe?.account_code ??
      (parent.meta as any)?.account_code ??
      'stripe_poland';

    // 2) Resolve Stripe secret and fetch refunds for this payment_intent.
    const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');

    const url = `https://api.stripe.com/v1/refunds?payment_intent=${encodeURIComponent(body.payment_intent)}&limit=20`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${sk}` } });
    const data = await resp.json();
    if (!resp.ok) {
      return jsonResponse({ ok: false, stripe_error: data?.error ?? data, status: resp.status });
    }
    const refunds = (data?.data ?? []) as StripeRefund[];
    let target = refunds;
    if (body.refund_id) target = refunds.filter((r) => r.id === body.refund_id);
    target = target.filter((r) => r.status === 'succeeded' && r.livemode !== false);

    if (target.length === 0) {
      return jsonResponse({
        ok: true,
        mode: body.dry_run ? 'dry_run' : 'execute',
        payment_intent: body.payment_intent,
        refunds_seen: refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status, livemode: r.livemode })),
        note: 'no_eligible_refunds',
      });
    }

    // 3) Dry-run: report what would be recorded.
    if (body.dry_run) {
      const preview = target.map((r) => ({
        refund_id: r.id,
        amount_major: toMajor(r.amount, r.currency),
        currency: r.currency.toUpperCase(),
        status: r.status,
        livemode: r.livemode,
        will_call: 'record_refund_atomic_multi',
        parent_payment_id: parent.id,
        order_id: parent.order_id,
      }));
      return jsonResponse({ ok: true, mode: 'dry_run', payment_intent: body.payment_intent, preview });
    }

    // 4) Execute: call canonical RPC for each refund. Idempotent by refund_uid.
    const results: any[] = [];
    for (const r of target) {
      const amountMajor = toMajor(r.amount, r.currency);
      const { data: rpcData, error: rpcErr } = await supabase.rpc('record_refund_atomic_multi', {
        p_order_id: parent.order_id,
        p_parent_payment_id: parent.id,
        p_refund_amount: amountMajor,
        p_refund_uid: r.id,
        p_provider: 'stripe',
        p_refund_reason: r.reason ?? 'stripe_repair_backfill',
        p_actor_user_id: actorUserId,
        p_target_user_id: parent.user_id,
        p_provider_response: {
          stripe: {
            charge_id: r.charge ?? null,
            payment_intent: r.payment_intent ?? body.payment_intent,
            account_code,
            event_type: 'admin.repair.fetch_refund',
            refund: r,
          },
        },
        p_meta_extra: {
          repair_source: 'admin-stripe-repair-refund-recording',
          repair_actor_label: actorLabel,
          repair_actor_user_id: actorUserId,
          recovered_at: new Date().toISOString(),
        },
      });
      if (rpcErr) {
        await supabase.from('audit_logs').insert({
          action: 'stripe.refund.repair_failed',
          entity_type: 'payments_v2',
          entity_id: parent.id,
          actor_type: actorUserId ? 'user' : 'system',
          actor_user_id: actorUserId,
          actor_label: actorLabel,
          meta: { error: rpcErr.message, refund_id: r.id, payment_intent: body.payment_intent },
        });
        results.push({ refund_id: r.id, ok: false, error: rpcErr.message });
        continue;
      }
      await supabase.from('audit_logs').insert({
        action: 'stripe.refund.repaired_via_admin_repair',
        entity_type: 'payments_v2',
        entity_id: parent.id,
        actor_type: actorUserId ? 'user' : 'system',
        actor_user_id: actorUserId,
        actor_label: actorLabel,
        meta: {
          refund_id: r.id,
          payment_intent: body.payment_intent,
          order_id: parent.order_id,
          amount_major: amountMajor,
          currency: r.currency.toUpperCase(),
          account_code,
          access_action: 'keep',
          note: 'recovery_only_no_stripe_api_create_call',
          rpc_result: rpcData,
        },
      });
      results.push({ refund_id: r.id, ok: true, amount_major: amountMajor, rpc: rpcData });
    }

    return jsonResponse({
      ok: true,
      mode: 'execute',
      payment_intent: body.payment_intent,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('acquiring_secret_not_found')) return errorResponse(msg, 500);
    if (msg.startsWith('unauthorized')) return errorResponse(msg, 401);
    if (msg.startsWith('forbidden')) return errorResponse(msg, 403);
    return errorResponse(msg, 500);
  }
});
