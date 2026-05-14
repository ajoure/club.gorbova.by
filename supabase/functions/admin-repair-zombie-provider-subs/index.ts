// REPAIR-BEPAID-ACCESS-2026-05 v3
// Admin-only repair for "zombie" provider_subscriptions:
//   state='active' AND provider='bepaid' AND
//   (subscription_v2_id IS NULL
//    OR linked subscriptions_v2.status IN ('expired','superseded','canceled')
//    OR linked subscriptions_v2.access_end_at < now())
//
// For each requested provider_subscriptions.id:
//   1) GET bePaid /v2/subscriptions/{id} (canonical pull, no manual snapshot)
//   2) Classify provider_state and decide action:
//        provider canceled/expired/terminated/finished -> cancel_local_only
//        provider active                                -> cancel_provider_then_local
//        ambiguous / API failure                        -> manual_review (no DB write)
//   3) If provider must be canceled, POST bePaid /v2/subscriptions/{id}/cancel
//   4) On success update provider_subscriptions.state='canceled' + meta + audit
//
// NEVER touched: payments_v2, orders_v2, entitlements, subscriptions_v2 (status/access).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REPAIR_BATCH = 'REPAIR-BEPAID-ACCESS-2026-05';

interface RepairRequest {
  provider_sub_row_ids: string[]; // provider_subscriptions.id
  dry_run?: boolean;
}

interface RowResult {
  provider_sub_row_id: string;
  provider_subscription_id?: string;
  user_id?: string | null;
  subscription_v2_id?: string | null;
  before_state?: string;
  after_state?: string;
  action: 'cancel_local_only' | 'cancel_provider_then_local' | 'manual_review' | 'failed_to_cancel_provider' | 'skipped_healthy' | 'skipped_not_found';
  bepaid_provider_state?: string;
  bepaid_response_status?: number;
  reason_class?: string;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const [{ data: hasAdmin }, { data: hasSuper }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);
    if (!(hasAdmin === true || hasSuper === true)) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json() as RepairRequest;
    const ids = Array.isArray(body?.provider_sub_row_ids) ? body.provider_sub_row_ids.filter(Boolean) : [];
    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: 'provider_sub_row_ids required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (ids.length > 50) {
      return new Response(JSON.stringify({ error: 'batch limit 50 per call' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const dryRun = body.dry_run === true;

    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ error: 'bePaid credentials missing', detail: credsResult.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidAuth = createBepaidAuthHeader(credsResult);

    // Load full rows
    const { data: rows, error: loadErr } = await supabase
      .from('provider_subscriptions')
      .select('id, provider, provider_subscription_id, state, user_id, subscription_v2_id, meta, subscriptions_v2(id, status, access_end_at, product_id, tariff_id)')
      .in('id', ids);
    if (loadErr) {
      return new Response(JSON.stringify({ error: 'load failed', detail: loadErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const rowMap = new Map((rows || []).map((r: any) => [r.id, r]));

    const results: RowResult[] = [];
    const nowMs = Date.now();

    for (const rowId of ids) {
      const row: any = rowMap.get(rowId);
      if (!row) {
        results.push({ provider_sub_row_id: rowId, action: 'skipped_not_found' });
        continue;
      }
      const psId: string = row.provider_subscription_id;
      // Healthy guard
      const sv2 = row.subscriptions_v2;
      const linkedHealthy = sv2 && sv2.status === 'active' && (!sv2.access_end_at || new Date(sv2.access_end_at).getTime() >= nowMs);
      if (row.state !== 'active' || row.provider !== 'bepaid' || linkedHealthy) {
        results.push({
          provider_sub_row_id: rowId,
          provider_subscription_id: psId,
          user_id: row.user_id,
          subscription_v2_id: row.subscription_v2_id,
          before_state: row.state,
          action: 'skipped_healthy',
          reason_class: 'guard_healthy_or_not_eligible',
        });
        continue;
      }

      // 1. Pull bePaid status
      let providerState = 'unknown';
      let pullStatus = 0;
      let pullExcerpt = '';
      try {
        const r = await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(psId)}`, {
          headers: { Authorization: bepaidAuth, 'Content-Type': 'application/json' },
        });
        pullStatus = r.status;
        const text = await r.text();
        pullExcerpt = text.slice(0, 400);
        if (r.ok) {
          try {
            const j = JSON.parse(text);
            providerState = String(j?.subscription?.state ?? j?.state ?? 'unknown').toLowerCase();
            if (providerState === 'cancelled') providerState = 'canceled';
          } catch {/* */}
        } else if (r.status === 404) {
          providerState = 'not_found';
        }
      } catch (e) {
        results.push({
          provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
          subscription_v2_id: row.subscription_v2_id, before_state: row.state,
          action: 'manual_review', reason_class: 'pull_failed', error: String(e),
        });
        continue;
      }

      const providerDead = ['canceled', 'expired', 'terminated', 'finished', 'failed', 'not_found'].includes(providerState);
      const providerActive = providerState === 'active';

      if (!providerDead && !providerActive) {
        results.push({
          provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
          subscription_v2_id: row.subscription_v2_id, before_state: row.state,
          action: 'manual_review', bepaid_provider_state: providerState, bepaid_response_status: pullStatus,
          reason_class: 'ambiguous_provider_state',
        });
        continue;
      }

      // 2. If provider still active — cancel at bePaid first
      let action: RowResult['action'] = providerDead ? 'cancel_local_only' : 'cancel_provider_then_local';
      let cancelStatus = 0;
      let cancelExcerpt = '';
      if (providerActive) {
        if (dryRun) {
          results.push({
            provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
            subscription_v2_id: row.subscription_v2_id, before_state: row.state,
            action, bepaid_provider_state: providerState, bepaid_response_status: pullStatus,
            reason_class: 'dry_run',
          });
          continue;
        }
        try {
          const c = await fetch(`https://api.bepaid.by/subscriptions/${encodeURIComponent(psId)}/cancel`, {
            method: 'POST',
            headers: { Authorization: bepaidAuth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cancel_reason: 'cancelled_by_admin' }),
          });
          cancelStatus = c.status;
          cancelExcerpt = (await c.text()).slice(0, 400);
          if (!c.ok) {
            results.push({
              provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
              subscription_v2_id: row.subscription_v2_id, before_state: row.state,
              action: 'failed_to_cancel_provider', bepaid_provider_state: providerState,
              bepaid_response_status: cancelStatus, reason_class: 'cancel_api_error', error: cancelExcerpt,
            });
            continue;
          }
        } catch (e) {
          results.push({
            provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
            subscription_v2_id: row.subscription_v2_id, before_state: row.state,
            action: 'failed_to_cancel_provider', bepaid_provider_state: providerState,
            reason_class: 'cancel_network_error', error: String(e),
          });
          continue;
        }
      }

      if (dryRun) {
        results.push({
          provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
          subscription_v2_id: row.subscription_v2_id, before_state: row.state,
          action, bepaid_provider_state: providerState, bepaid_response_status: pullStatus,
          reason_class: 'dry_run',
        });
        continue;
      }

      // 3. Local update
      const reasonClass = action === 'cancel_local_only'
        ? 'inv_zombie_provider_dead_2026_05'
        : 'local_expired_provider_active_2026_05';
      const newMeta = {
        ...(row.meta || {}),
        cancel_reason: reasonClass,
        repair_batch: REPAIR_BATCH,
        repaired_at: new Date().toISOString(),
        bepaid_provider_state_at_repair: providerState,
        bepaid_pull_excerpt: pullExcerpt,
        bepaid_cancel_status: cancelStatus || null,
        bepaid_cancel_excerpt: cancelExcerpt || null,
      };
      const { error: updErr } = await supabase
        .from('provider_subscriptions')
        .update({ state: 'canceled', meta: newMeta, updated_at: new Date().toISOString() })
        .eq('id', rowId);
      if (updErr) {
        results.push({
          provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
          subscription_v2_id: row.subscription_v2_id, before_state: row.state,
          action: 'manual_review', bepaid_provider_state: providerState,
          reason_class: 'local_update_failed', error: updErr.message,
        });
        continue;
      }

      // 4. Audit
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'inv_zombie_repair_2026_05',
        target_user_id: row.user_id || null,
        action: 'provider_subscription.canceled.zombie_repair_2026_05',
        meta: {
          provider_sub_row_id: rowId,
          provider_subscription_id: psId,
          subscription_v2_id: row.subscription_v2_id,
          before_state: row.state,
          after_state: 'canceled',
          bepaid_provider_state: providerState,
          bepaid_response_status: pullStatus,
          bepaid_cancel_status: cancelStatus || null,
          bepaid_cancel_excerpt: cancelExcerpt || null,
          repair_batch: REPAIR_BATCH,
          reason_class: reasonClass,
          repair_action: action,
          triggered_by_admin_id: user.id,
        },
      });

      results.push({
        provider_sub_row_id: rowId, provider_subscription_id: psId, user_id: row.user_id,
        subscription_v2_id: row.subscription_v2_id,
        before_state: row.state, after_state: 'canceled',
        action, bepaid_provider_state: providerState, bepaid_response_status: pullStatus,
        reason_class: reasonClass,
      });
    }

    return new Response(JSON.stringify({
      ok: true, dry_run: dryRun, batch: REPAIR_BATCH, processed: results.length, results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
