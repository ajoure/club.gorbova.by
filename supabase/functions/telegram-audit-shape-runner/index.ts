/**
 * telegram-audit-shape-runner
 *
 * Server-side trigger for Telegram audit-shape dry-runs.
 *
 * Contract:
 *  - JWT REQUIRED, role = super_admin (has_role_v2). No service-role bypass.
 *  - Body: { scenario: <enum> }. RAW telegram payload is NOT accepted.
 *  - Quota: max 10 runs per actor per rolling 10 minutes (counts ALL outcomes).
 *  - All outcomes (unauth / not-superadmin / quota_exceeded / invoke_error / ok)
 *    are persisted to telegram_audit_shape_runs.
 *  - Invokes telegram-webhook with x-audit-shape-secret + synthesised
 *    _audit_shape_meta + a synthetic update body. The webhook itself enforces
 *    audit-shape no-op semantics (no real Telegram calls, no mutations to
 *    telegram_club_members / telegram_invite_links).
 *
 * Allowed scenarios (CHECK constraint mirror):
 *   INVITE_USED, INVITE_MISMATCH, INVITE_EXPIRED_OR_REUSED,
 *   INVITE_BLOCKED_VERIFIED, INVITE_REVOKED, INVITE_BLOCKED_CROSS_CLUB
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_SCENARIOS = [
  'INVITE_USED',
  'INVITE_MISMATCH',
  'INVITE_EXPIRED_OR_REUSED',
  'INVITE_BLOCKED_VERIFIED',
  'INVITE_REVOKED',
  'INVITE_BLOCKED_CROSS_CLUB',
] as const;
type Scenario = (typeof ALLOWED_SCENARIOS)[number];

const QUOTA_WINDOW_MIN = 10;
const QUOTA_MAX_RUNS = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Insert an outcome row using service role. Never throws.
 */
async function recordRun(
  admin: ReturnType<typeof createClient>,
  row: {
    actor_user_id: string;
    scenario: Scenario | null;
    status: 'ok' | 'denied' | 'error';
    meta: Record<string, unknown>;
  },
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('telegram_audit_shape_runs')
      .insert({
        actor_user_id: row.actor_user_id,
        // CHECK constraint requires a known scenario; fall back to a safe one
        // for pre-validation rejections (denial reason is in meta).
        scenario: row.scenario || 'INVITE_USED',
        status: row.status,
        meta: { ...row.meta, source: 'audit_shape_runner' },
      })
      .select('id')
      .single();
    if (error) {
      console.error('[runner] recordRun failed', error);
      return null;
    }
    return (data as any)?.id || null;
  } catch (e) {
    console.error('[runner] recordRun threw', e);
    return null;
  }
}

/**
 * Build a synthetic, internally-constructed Telegram update for a scenario.
 * NOTE: this payload is hand-built — clients cannot inject arbitrary updates.
 */
function buildSyntheticUpdate(scenario: Scenario, runId: string) {
  // A minimal `chat_join_request`-shaped update is enough for the webhook to
  // exercise invite-validation paths under audit-shape (where every mutation
  // and Telegram HTTP call is suppressed). We deliberately keep IDs synthetic
  // so even if the audit-shape guard ever leaked, joins to real DB rows would
  // miss.
  const synthChatId = -1000000000000 - Math.floor(Math.random() * 1_000_000);
  const synthUserId = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
  return {
    update_id: Math.floor(Date.now() / 1000),
    chat_join_request: {
      chat: { id: synthChatId, type: 'supergroup', title: `audit-shape:${scenario}` },
      from: {
        id: synthUserId,
        is_bot: false,
        first_name: 'AuditShape',
        username: `audit_shape_${runId.slice(0, 8)}`,
      },
      date: Math.floor(Date.now() / 1000),
      invite_link: {
        invite_link: `https://t.me/+audit_shape_${scenario}_${runId.slice(0, 8)}`,
        name: `audit-shape:${scenario}`,
        creator: { id: 1, is_bot: true, first_name: 'bot' },
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auditSecret = Deno.env.get('AUDIT_SHAPE_SECRET') || '';
  const admin = createClient(supabaseUrl, serviceKey);

  // ---------- AUTH ----------
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    await recordRun(admin, {
      actor_user_id: '00000000-0000-0000-0000-000000000000',
      scenario: null,
      status: 'denied',
      meta: { reason: 'missing_jwt' },
    });
    return json({ ok: false, error: 'unauthorized', reason: 'missing_jwt' }, 401);
  }

  const userClient = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    await recordRun(admin, {
      actor_user_id: '00000000-0000-0000-0000-000000000000',
      scenario: null,
      status: 'denied',
      meta: { reason: 'invalid_jwt' },
    });
    return json({ ok: false, error: 'unauthorized', reason: 'invalid_jwt' }, 401);
  }
  const actorUserId = userData.user.id;

  const { data: isSuper, error: roleErr } = await admin.rpc('has_role_v2', {
    _user_id: actorUserId,
    _role_code: 'super_admin',
  });
  if (roleErr || !isSuper) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: null,
      status: 'denied',
      meta: { reason: 'not_superadmin', role_err: roleErr?.message || null },
    });
    return json(
      { ok: false, error: 'forbidden', reason: 'superadmin_required' },
      403,
    );
  }

  // ---------- INPUT VALIDATION (enum-only, no raw payload) ----------
  const body = await req.json().catch(() => null);
  const scenario = body && typeof body.scenario === 'string' ? body.scenario : null;
  if (!scenario || !ALLOWED_SCENARIOS.includes(scenario as Scenario)) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: null,
      status: 'denied',
      meta: {
        reason: 'invalid_scenario',
        provided: scenario,
        allowed: ALLOWED_SCENARIOS,
      },
    });
    return json(
      {
        ok: false,
        error: 'bad_request',
        reason: 'invalid_scenario',
        allowed: ALLOWED_SCENARIOS,
      },
      400,
    );
  }
  // Reject any attempt to pass raw payload.
  if (body && (body.update || body.payload || body.raw || body._audit_shape_meta)) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: scenario as Scenario,
      status: 'denied',
      meta: {
        reason: 'raw_payload_forbidden',
        offending_keys: Object.keys(body).filter((k) =>
          ['update', 'payload', 'raw', '_audit_shape_meta'].includes(k),
        ),
      },
    });
    return json(
      { ok: false, error: 'bad_request', reason: 'raw_payload_forbidden' },
      400,
    );
  }

  // ---------- QUOTA: 10 / 10min / actor ----------
  const sinceIso = new Date(Date.now() - QUOTA_WINDOW_MIN * 60 * 1000).toISOString();
  const { count: recentCount, error: quotaErr } = await admin
    .from('telegram_audit_shape_runs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_user_id', actorUserId)
    .gte('created_at', sinceIso);
  if (quotaErr) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: scenario as Scenario,
      status: 'error',
      meta: { reason: 'quota_query_failed', err: quotaErr.message },
    });
    return json(
      { ok: false, error: 'internal', reason: 'quota_query_failed' },
      500,
    );
  }
  if ((recentCount ?? 0) >= QUOTA_MAX_RUNS) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: scenario as Scenario,
      status: 'denied',
      meta: {
        reason: 'quota_exceeded',
        window_minutes: QUOTA_WINDOW_MIN,
        max: QUOTA_MAX_RUNS,
        recent_count: recentCount,
      },
    });
    return json(
      {
        ok: false,
        error: 'quota_exceeded',
        window_minutes: QUOTA_WINDOW_MIN,
        max: QUOTA_MAX_RUNS,
      },
      429,
    );
  }

  // ---------- INVOKE telegram-webhook IN AUDIT-SHAPE MODE ----------
  if (!auditSecret) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: scenario as Scenario,
      status: 'error',
      meta: { reason: 'audit_secret_not_configured' },
    });
    return json(
      { ok: false, error: 'internal', reason: 'audit_secret_not_configured' },
      500,
    );
  }

  // Pre-create a runner-side run row so we always have an id to correlate,
  // even if the webhook fails to insert its own row.
  const runId = crypto.randomUUID();
  const runnerRowId = await recordRun(admin, {
    actor_user_id: actorUserId,
    scenario: scenario as Scenario,
    status: 'ok', // provisional — will not be flipped; webhook records its own row
    meta: {
      reason: 'invoke_started',
      runner_run_id: runId,
      window_minutes: QUOTA_WINDOW_MIN,
      max: QUOTA_MAX_RUNS,
      recent_count_before: recentCount,
    },
  });

  // Resolve a real active bot_id (UUID required by the webhook). Audit-shape
  // mode prevents any DB mutation regardless of bot, so picking any active bot
  // is safe and side-effect-free.
  const { data: anyBot, error: botErr } = await admin
    .from('telegram_bots')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (botErr || !anyBot?.id) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: scenario as Scenario,
      status: 'error',
      meta: {
        reason: 'no_active_bot_for_audit_shape',
        runner_run_id: runId,
        err: botErr?.message || null,
      },
    });
    return json(
      { ok: false, error: 'internal', reason: 'no_active_bot_for_audit_shape' },
      500,
    );
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook?bot_id=${anyBot.id}`;
  const auditMeta = {
    scenario,
    actor_user_id: actorUserId,
    runner_run_id: runId,
    issued_at: new Date().toISOString(),
  };
  const syntheticBody = {
    ...buildSyntheticUpdate(scenario as Scenario, runId),
    _audit_shape_meta: auditMeta,
  };

  let webhookStatus = 0;
  let webhookBody: unknown = null;
  let invokeErr: string | null = null;
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-audit-shape-secret': auditSecret,
        // service-role for invoking the function endpoint itself
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify(syntheticBody),
    });
    webhookStatus = resp.status;
    webhookBody = await resp.json().catch(() => null);
  } catch (e) {
    invokeErr = (e as Error).message || String(e);
  }

  if (invokeErr || webhookStatus >= 500) {
    await recordRun(admin, {
      actor_user_id: actorUserId,
      scenario: scenario as Scenario,
      status: 'error',
      meta: {
        reason: 'webhook_invoke_failed',
        runner_run_id: runId,
        runner_row_id: runnerRowId,
        webhook_status: webhookStatus,
        webhook_body: webhookBody,
        invoke_err: invokeErr,
      },
    });
    return json(
      {
        ok: false,
        error: 'webhook_invoke_failed',
        runner_run_id: runId,
        webhook_status: webhookStatus,
        webhook_body: webhookBody,
      },
      502,
    );
  }

  return json({
    ok: true,
    runner_run_id: runId,
    runner_row_id: runnerRowId,
    scenario,
    webhook_status: webhookStatus,
    webhook_body: webhookBody,
  });
});
