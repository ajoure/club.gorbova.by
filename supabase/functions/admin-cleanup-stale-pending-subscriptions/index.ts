// Phase 3.1.0-B — Manual admin cleanup of stale pending subscriptions.
//
// Назначение: перевести `subscriptions_v2` со status='pending' и created_at < now()-24h
// в status='expired' (checkout abandoned). Cron НЕ создаётся в MVP.
//
// ЖЁСТКИЕ ОГРАНИЧЕНИЯ:
//   - super_admin only (RBAC через has_role_v2).
//   - dry_run по умолчанию.
//   - execute=true без allow_real обрабатывает ТОЛЬКО строки с meta.test_fixture=true.
//   - allow_real=true (super_admin override) разрешает закрывать реальные stale pending.
//   - НЕ зовёт bePaid/Stripe API.
//   - Удаление placeholder в provider_subscriptions — только строгим фильтром:
//       provider='stripe' AND state='pending'
//       AND provider_subscription_id LIKE 'pending:%'
//       AND subscription_v2_id = <конкретный id>.
//     bePaid не трогаем.
//   - НЕ требует новых RLS/RPC/grants.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface ReqBody {
  dry_run?: boolean;
  limit?: number;
  allow_real?: boolean;
}

interface PendingRow {
  id: string;
  user_id: string;
  product_id: string;
  tariff_id: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: hasRole, error: roleErr } = await admin.rpc('has_role_v2', {
      _user_id: user.id,
      _role: 'super_admin',
    });
    if (roleErr || !hasRole) {
      console.warn('[admin-cleanup-stale-pending] forbidden', { user_id: user.id });
      return json({ error: 'Forbidden: super_admin required' }, 403);
    }

    const body: ReqBody = await safeJson(req);
    const dryRun = body.dry_run !== false;
    const limit = Math.max(1, Math.min(500, body.limit ?? 100));
    const allowReal = body.allow_real === true;

    const cutoffIso = new Date(Date.now() - PENDING_TTL_MS).toISOString();
    const { data: candRaw, error: candErr } = await admin
      .from('subscriptions_v2')
      .select('id, user_id, product_id, tariff_id, created_at, meta')
      .eq('status', 'pending')
      .lt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (candErr) {
      console.error('[admin-cleanup-stale-pending] query failed', candErr);
      return json({ error: 'query_failed', details: candErr.message }, 500);
    }

    const candidates = (candRaw as PendingRow[] | null) ?? [];
    const testFixtures = candidates.filter((c) => (c.meta as any)?.test_fixture === true);
    const realRows = candidates.filter((c) => (c.meta as any)?.test_fixture !== true);
    const eligible = allowReal ? candidates : testFixtures;

    if (dryRun) {
      return json({
        dry_run: true,
        found: candidates.length,
        test_fixtures: testFixtures.length,
        real_rows: realRows.length,
        would_change: eligible.length,
        allow_real: allowReal,
        sample_ids: eligible.slice(0, 5).map((c) => c.id),
      });
    }

    let changed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const c of eligible) {
      const { error: delErr } = await admin
        .from('provider_subscriptions')
        .delete()
        .eq('subscription_v2_id', c.id)
        .eq('provider', 'stripe')
        .eq('state', 'pending')
        .like('provider_subscription_id', 'pending:%');
      if (delErr) {
        console.warn('[admin-cleanup-stale-pending] provider_subscriptions delete warn', {
          id: c.id, err: delErr.message,
        });
      }

      const nowIso = new Date().toISOString();
      const mergedMeta = {
        ...(c.meta ?? {}),
        lifecycle: {
          ...((c.meta as any)?.lifecycle ?? {}),
          timeout_reason: 'checkout_abandoned',
          cleaned_at: nowIso,
          cleaned_by: user.id,
        },
      };
      const { error: updErr } = await admin
        .from('subscriptions_v2')
        .update({ status: 'expired', auto_renew: false, meta: mergedMeta })
        .eq('id', c.id)
        .eq('status', 'pending');
      if (updErr) {
        errors.push({ id: c.id, error: updErr.message });
        continue;
      }

      await admin.from('audit_logs').insert({
        actor_type: 'user',
        actor_user_id: user.id,
        target_user_id: c.user_id,
        action: 'subscription.pending_cleaned_up',
        meta: {
          subscription_v2_id: c.id,
          product_id: c.product_id,
          tariff_id: c.tariff_id,
          original_created_at: c.created_at,
          age_minutes: Math.floor((Date.now() - new Date(c.created_at).getTime()) / 60000),
          test_fixture: (c.meta as any)?.test_fixture === true,
          allow_real: allowReal,
          source: 'admin-cleanup-stale-pending-subscriptions',
        },
      });

      changed += 1;
    }

    return json({
      dry_run: false,
      found: candidates.length,
      test_fixtures: testFixtures.length,
      real_rows: realRows.length,
      would_change: eligible.length,
      changed,
      errors,
      allow_real: allowReal,
    });
  } catch (e) {
    console.error('[admin-cleanup-stale-pending] unhandled', e);
    return json({ error: 'internal', details: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function safeJson(req: Request): Promise<ReqBody> {
  try { return await req.json(); } catch { return {}; }
}
