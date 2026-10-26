import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { inspectReceiptSync, enqueueReceiptForRecovery } from './receipt-sync-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// PATCH-H: Centralized status normalization
function normalizeStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  if (status === 'cancelled') return 'canceled';
  return status;
}

// PATCH-B: Multi-path truth extraction helper
function pickFirst(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v != null && v !== '' && typeof v === 'string') return v;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC: Only admin allowed
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH-A: Check both admin and superadmin (correct enum values)
    const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);

    const isAdmin = hasAdmin === true || hasSuperAdmin === true;
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subscription_id } = await req.json();
    if (!subscription_id) {
      return new Response(JSON.stringify({ error: 'subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ error: 'bePaid credentials not configured: ' + credsResult.error, code: 'BEPAID_CREDS_MISSING' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidCreds = credsResult;
    const authString = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');

    // Fetch subscription details from bePaid
    const response = await fetch(`https://api.bepaid.by/subscriptions/${subscription_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[bepaid-get-subscription-details] bePaid error: ${response.status} ${text}`);
      // PATCH 2: Audit log on API failure
      await supabase.from('audit_logs').insert({
        action: 'bepaid.sync_failed',
        actor_type: 'system',
        actor_label: 'bepaid-get-subscription-details',
        meta: { subscription_id, status: response.status, error: text.substring(0, 500) },
      });
      // PATCH: return HTTP 200 with structured signal so supabase.functions.invoke
      // does not throw and crash the UI. 404 → not_found, 5xx → fallback.
      const notFound = response.status === 404;
      const isFallbackable = response.status >= 500;
      return new Response(JSON.stringify({
        ok: false,
        error: notFound
          ? 'Subscription not found in bePaid'
          : 'Failed to fetch subscription from bePaid',
        not_found: notFound,
        fallback: isFallbackable,
        upstream_status: response.status,
        details: text.substring(0, 500),
        subscription_id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const sub = data.subscription || data;
    if (sub.id && sub.id !== subscription_id) throw new Error('provider_subscription_identity_mismatch');
    const normalizedState = normalizeStatus(sub.state || sub.status);
    const snapshot = {
      id: sub.id, state: normalizedState, raw_state: sub.state || sub.status,
      next_billing_at: sub.next_billing_at,
      renew_at: pickFirst(sub.renew_at, sub.next_billing_at, sub.subscription?.renew_at,
        sub.subscription?.next_billing_at, data.renew_at, data.next_billing_at),
      active_to: pickFirst(sub.active_to, sub.valid_till, sub.subscription?.active_to,
        sub.subscription?.valid_till, data.active_to, data.valid_till),
      valid_till: sub.valid_till, last_payment_at: sub.last_payment_at,
      last_payment_status: sub.last_transaction?.status,
      last_payment_error: sub.last_transaction?.message,
      is_cancelable: !['canceled', 'terminated'].includes(normalizedState),
      plan: sub.plan, customer: sub.customer, credit_card: sub.credit_card,
      created_at: sub.created_at, updated_at: sub.updated_at, raw_keys: Object.keys(sub),
    };
    const cancellation_capability = ['canceled', 'terminated'].includes(normalizedState)
      ? 'not_applicable' : ['active', 'trial'].includes(normalizedState) ? 'can_cancel_now' : 'unknown';

    // EARLIEST receipt policy: before snapshot writes, autolinking, payment or
    // access propagation. A snapshot is observation, never paid fulfillment.
    const tx = sub.last_transaction;
    let receipt: any = { kind: 'no_successful_transaction' };
    if (tx?.uid) {
      const incoming = { ...tx, tracking_id: tx.tracking_id || sub.tracking_id || sub.subscription?.tracking_id };
      receipt = await inspectReceiptSync(supabase, tx.uid, incoming);
      if (receipt.kind === 'absent' && ['successful', 'succeeded', 'paid', 'success'].includes(String(tx.status).toLowerCase())) {
        receipt = await enqueueReceiptForRecovery(supabase, incoming, 'subscription_snapshot', subscription_id);
      }
    } else if (['successful', 'succeeded', 'paid', 'success'].includes(String(tx?.status).toLowerCase())) {
      receipt = { kind: 'hold', reason: 'receipt_sync_missing_uid' };
    }
    if (receipt.kind === 'hold') return new Response(JSON.stringify({ success: false,
      error: receipt.reason, manual_review: true, financial_access_unchanged: true,
      fulfillment_verified: false, subscription_id, snapshot, cancellation_capability,
    }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const existing = await supabase.from('provider_subscriptions')
      .select('id,updated_at,meta').eq('provider', 'bepaid')
      .eq('provider_subscription_id', subscription_id).maybeSingle();
    if (existing.error) throw new Error('provider_snapshot_lookup_failed');
    let snapshot_updated = false;
    if (existing.data) {
      // CACHE ONLY. No local subscription, order, payment, entitlement, Telegram,
      // provider link or card mutation. CAS refuses a stale metadata overwrite.
      if (!existing.data.updated_at) throw new Error('provider_snapshot_missing_version');
      const updated = await supabase.from('provider_subscriptions').update({
        state: normalizedState, next_charge_at: snapshot.renew_at,
        meta: { ...(existing.data.meta || {}), provider_snapshot: snapshot,
          snapshot_at: new Date().toISOString(), cancellation_capability },
      }).eq('id', existing.data.id).eq('updated_at', existing.data.updated_at)
        .select('id').maybeSingle();
      if (updated.error || !updated.data?.id) throw new Error('provider_snapshot_conflict');
      snapshot_updated = true;
    }
    return new Response(JSON.stringify({ success: true, subscription_id, snapshot,
      is_cancelable: snapshot.is_cancelable, cancellation_capability, snapshot_updated,
      // Queue insertion is explicitly reported; it is not an access result.
      receipt_processing: { kind: receipt.kind, order_id: receipt.orderId || null,
        queue_id: receipt.queueId || null, queue_status: receipt.queueStatus || null },
      direct_business_writes: 0, fulfillment_verified: false,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[bepaid-get-subscription-details] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
