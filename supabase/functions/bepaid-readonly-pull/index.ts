// READ-ONLY bePaid subscription pull
// Strict contract: NO writes to subscriptions_v2 / provider_subscriptions / audit_logs / Telegram.
// Used for H3.x-c-provider-pull diagnostic only.
// Returns raw provider state per sbs_*; caller decides what (if anything) to do next.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { authorizePaymentsReconcile } from '../payments-reconcile/auth.ts';
import { parseBepaidTrackingId } from '../_shared/bepaid-tracking-id.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-payments-reconcile-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function normalizeStatus(s: string | undefined | null): string {
  if (!s) return 'unknown';
  if (s === 'cancelled') return 'canceled';
  return s;
}

function safeTracking(raw: unknown) {
  const parsed = parseBepaidTrackingId(typeof raw === 'string' ? raw : null);
  const uuid = (value: string | null) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
  return { kind: parsed.kind, orderId: uuid(parsed.orderId), offerId: uuid(parsed.offerId), subscriptionV2Id: uuid(parsed.subscriptionV2Id) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Server-side diagnostics can use the exact service credential or the
    // dedicated Vault-backed reconciliation secret. Never copy service keys
    // out of production just to call this GET-only diagnostic surface.
    // Existing operator access still requires a verified admin user.
    if (!await authorizePaymentsReconcile(req, serviceKey, supabase)) {
    // RBAC: admin or superadmin only
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);
    if (!(hasAdmin === true || hasSuperAdmin === true)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.subscription_ids) ? body.subscription_ids : [];
    const transactionUids: string[] = Array.isArray(body?.transaction_uids) ? body.transaction_uids : [];
    if (ids.length + transactionUids.length === 0 || ids.length > 50 || transactionUids.length > 10 ||
      !ids.every(id => typeof id === 'string' && /^sbs_[A-Za-z0-9_-]{1,128}$/.test(id)) ||
      !transactionUids.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) {
      return new Response(JSON.stringify({ error: 'Provide up to 50 subscription_ids or 10 transaction_uids with valid identifiers' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ error: 'bePaid credentials not configured', detail: credsResult.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const authStr = createBepaidAuthHeader(credsResult);

    const results: any[] = [];
    for (const sbs of ids) {
      const t0 = Date.now();
      try {
        const resp = await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(sbs)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Authorization': authStr,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });
        const text = await resp.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { /* leave null */ }
        const sub = parsed?.subscription || parsed;

        results.push({
          subscription_id: sbs,
          http_status: resp.status,
          ok: resp.ok,
          latency_ms: Date.now() - t0,
          provider_state_raw: sub?.state ?? sub?.status ?? null,
          provider_state_normalized: normalizeStatus(sub?.state ?? sub?.status),
          active_to: sub?.active_to ?? sub?.valid_till ?? null,
          renew_at: sub?.renew_at ?? sub?.next_billing_at ?? null,
          last_payment_at: sub?.last_payment_at ?? null,
          last_payment_status: sub?.last_transaction?.status ?? null,
          last_payment_message: sub?.last_transaction?.message ?? null,
          last_transaction_uid: sub?.last_transaction?.uid ?? null,
          last_transaction_amount: sub?.last_transaction?.amount ?? null,
          last_transaction_currency: sub?.last_transaction?.currency ?? null,
          last_transaction_paid_at: sub?.last_transaction?.paid_at ?? null,
          plan_id: sub?.plan?.id ?? null,
          tracking_id: sub?.tracking_id ?? sub?.additional_data?.tracking_id ?? null,
          provider_created_at: sub?.created_at ?? null,
          provider_updated_at: sub?.updated_at ?? null,
          raw_keys: sub && typeof sub === 'object' ? Object.keys(sub) : null,
          // truncated body for failure diagnostics only
          error_excerpt: resp.ok ? null : `Provider HTTP ${resp.status}`,
        });
      } catch (e: any) {
        results.push({
          subscription_id: sbs,
          http_status: 0,
          ok: false,
          latency_ms: Date.now() - t0,
          error_excerpt: String(e?.message ?? e).slice(0, 500),
        });
      }
    }

    const transactions: Record<string, unknown>[] = [];
    for (const uid of transactionUids) {
      try {
        const response = await fetch(`https://gateway.bepaid.by/transactions/${encodeURIComponent(uid)}`, {
          method: 'GET', signal: AbortSignal.timeout(15_000),
          headers: { Authorization: authStr, Accept: 'application/json' },
        });
        const data = response.ok ? await response.json() : null;
        const tx = data?.transaction;
        transactions.push({
          requested_uid: uid, http_status: response.status, ok: response.ok && !!tx,
          uid: tx?.uid ?? null, status: tx?.status ?? null, type: tx?.type ?? null,
          amount: tx?.amount ?? null, currency: tx?.currency ?? null,
          paid_at: tx?.paid_at ?? null, created_at: tx?.created_at ?? null,
          parent_uid: tx?.parent_uid ?? null,
          // Only parsed project identifiers, never arbitrary descriptions,
          // customer/card data or raw provider payloads.
          tracking: safeTracking(tx?.tracking_id),
        });
      } catch {
        transactions.push({ requested_uid: uid, ok: false, http_status: 0, error: 'provider_request_failed' });
      }
    }

    return new Response(JSON.stringify({
      mode: 'read_only',
      transactions,
      no_writes: true,
      pulled_at: new Date().toISOString(),
      count: results.length,
      results,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'internal_error', detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
