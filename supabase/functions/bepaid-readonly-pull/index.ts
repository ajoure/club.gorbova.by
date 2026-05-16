// READ-ONLY bePaid subscription pull
// Strict contract: NO writes to subscriptions_v2 / provider_subscriptions / audit_logs / Telegram.
// Used for H3.x-c-provider-pull diagnostic only.
// Returns raw provider state per sbs_*; caller decides what (if anything) to do next.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function normalizeStatus(s: string | undefined | null): string {
  if (!s) return 'unknown';
  if (s === 'cancelled') return 'canceled';
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

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

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.subscription_ids) ? body.subscription_ids : [];
    if (ids.length === 0 || ids.length > 50) {
      return new Response(JSON.stringify({ error: 'subscription_ids: array of 1..50 sbs_* required' }), {
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
          plan_id: sub?.plan?.id ?? null,
          tracking_id: sub?.tracking_id ?? sub?.additional_data?.tracking_id ?? null,
          provider_created_at: sub?.created_at ?? null,
          provider_updated_at: sub?.updated_at ?? null,
          raw_keys: sub && typeof sub === 'object' ? Object.keys(sub) : null,
          // truncated body for failure diagnostics only
          error_excerpt: resp.ok ? null : text.slice(0, 500),
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

    return new Response(JSON.stringify({
      mode: 'read_only',
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
