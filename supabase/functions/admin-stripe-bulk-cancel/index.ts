// STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream B — Bulk Stripe subscription cancel.
//
// Жёсткие правила:
//   - Только Stripe (v1). bePaid — отдельным патчем.
//   - Только super_admin (JWT-проверка).
//   - dry_run по умолчанию = true. execute требует batch_id из dry-run.
//   - batch ≤ 50 UUID. Только UUID.
//   - Никаких прямых INSERT entitlements / access_rules / telegram_*.
//   - Никакого Telegram revoke из bulk endpoint.
//   - Доступ не отзывается; webhook сам синхронизирует state.
//   - Per-item idempotency: ошибка одной подписки не ломает batch.
//   - Audit:
//       admin.subscriptions.bulk_cancel.dry_run
//       admin.subscriptions.bulk_cancel.execute.{period_end|immediate}.{ok|skip|stripe_error|db_error}
//
// Внутри — последовательный обход с invoke('stripe-subscription-action') чтобы
// не дублировать логику single-cancel.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BATCH = 50;
const DRY_RUN_TTL_MS = 15 * 60 * 1000; // 15 минут

type Mode = 'period_end' | 'immediate';

interface DryRunBody {
  subscription_ids: string[];
  mode: Mode;
  dry_run: true;
  reason?: string;
}
interface ExecuteBody {
  batch_id: string;
  confirm: true;
  reason?: string;
}

interface PerItem {
  subscription_v2_id: string;
  eligibility: 'eligible' | 'already_canceled' | 'already_scheduled' | 'provider_missing' | 'not_stripe' | 'status_blocked' | 'not_found';
  current_status: string | null;
  provider: string | null;
  provider_subscription_id: string | null;
  cancel_at_period_end?: boolean;
  skip_reason?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// In-memory dry-run snapshot store (per-instance). Достаточно для bulk-операций
// в течение TTL; пересоздаётся при cold start — execute тогда вернёт STALE_DRY_RUN.
interface BatchSnapshot {
  batch_id: string;
  actor_user_id: string;
  mode: Mode;
  items: PerItem[];
  eligible_ids: string[];
  created_at: number;
}
const BATCH_STORE = new Map<string, BatchSnapshot>();
function pruneBatches() {
  const now = Date.now();
  for (const [k, v] of BATCH_STORE.entries()) {
    if (now - v.created_at > DRY_RUN_TTL_MS) BATCH_STORE.delete(k);
  }
}

async function loadSnapshot(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<PerItem[]> {
  const items: PerItem[] = [];

  const { data: subs } = await supabase
    .from('subscriptions_v2')
    .select('id, status, meta')
    .in('id', ids);

  const subMap = new Map<string, any>();
  for (const r of (subs ?? [])) subMap.set((r as any).id, r);

  const { data: provs } = await supabase
    .from('provider_subscriptions')
    .select('subscription_v2_id, provider, provider_subscription_id, state')
    .in('subscription_v2_id', ids);

  const provMap = new Map<string, any>();
  for (const r of (provs ?? [])) {
    const sid = (r as any).subscription_v2_id as string;
    // Берём stripe-row, если есть; иначе любой.
    const existing = provMap.get(sid);
    if (!existing || (r as any).provider === 'stripe') provMap.set(sid, r);
  }

  for (const id of ids) {
    const sub = subMap.get(id);
    if (!sub) {
      items.push({
        subscription_v2_id: id,
        eligibility: 'not_found',
        current_status: null,
        provider: null,
        provider_subscription_id: null,
      });
      continue;
    }
    const prov = provMap.get(id);
    const meta = (sub.meta ?? {}) as any;
    const cancelAtPeriodEnd = !!(meta?.stripe?.cancel_at_period_end);

    if (!prov || prov.provider !== 'stripe') {
      items.push({
        subscription_v2_id: id,
        eligibility: 'not_stripe',
        current_status: sub.status,
        provider: prov?.provider ?? null,
        provider_subscription_id: prov?.provider_subscription_id ?? null,
        skip_reason: prov ? 'provider_is_not_stripe' : 'provider_subscription_missing',
      });
      continue;
    }
    if (!prov.provider_subscription_id || !String(prov.provider_subscription_id).startsWith('sub_')) {
      items.push({
        subscription_v2_id: id,
        eligibility: 'provider_missing',
        current_status: sub.status,
        provider: 'stripe',
        provider_subscription_id: prov.provider_subscription_id ?? null,
        skip_reason: 'stripe_subscription_id_invalid',
      });
      continue;
    }
    if (sub.status === 'canceled' || sub.status === 'expired' || sub.status === 'superseded') {
      items.push({
        subscription_v2_id: id,
        eligibility: 'already_canceled',
        current_status: sub.status,
        provider: 'stripe',
        provider_subscription_id: prov.provider_subscription_id,
        skip_reason: `terminal_status:${sub.status}`,
      });
      continue;
    }
    if (cancelAtPeriodEnd) {
      items.push({
        subscription_v2_id: id,
        eligibility: 'already_scheduled',
        current_status: sub.status,
        provider: 'stripe',
        provider_subscription_id: prov.provider_subscription_id,
        cancel_at_period_end: true,
        skip_reason: 'cancel_at_period_end_already_set',
      });
      continue;
    }
    items.push({
      subscription_v2_id: id,
      eligibility: 'eligible',
      current_status: sub.status,
      provider: 'stripe',
      provider_subscription_id: prov.provider_subscription_id,
      cancel_at_period_end: cancelAtPeriodEnd,
    });
  }
  return items;
}

async function callSingleCancel(
  authHeader: string,
  subscriptionV2Id: string,
  mode: Mode,
): Promise<{ ok: boolean; status: number; detail: string }> {
  const action = mode === 'period_end' ? 'cancel_at_period_end' : 'cancel_now';
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-subscription-action`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        subscription_v2_id: subscriptionV2Id,
        action,
        dry_run: false,
      }),
    });
    const text = await resp.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return {
      ok: resp.ok && !parsed?.error,
      status: resp.status,
      detail: parsed?.error ?? parsed?.detail ?? (resp.ok ? 'ok' : `http_${resp.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, detail: `network:${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // ── Auth: super_admin via JWT + has_role ───────────────────────────────
  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) return json({ error: 'unauthorized' }, 401);
  const actorUserId = claimsData.claims.sub as string;
  const actorEmail = (claimsData.claims as any).email ?? null;

  const { data: isSuper, error: roleErr } = await supabase.rpc('has_role', {
    _user_id: actorUserId,
    _role: 'super_admin',
  });
  if (roleErr || !isSuper) return json({ error: 'forbidden', detail: 'super_admin_required' }, 403);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const body = (raw ?? {}) as Record<string, unknown>;

  pruneBatches();

  // ── EXECUTE path ───────────────────────────────────────────────────────
  if (body.confirm === true && typeof body.batch_id === 'string') {
    const exec = body as unknown as ExecuteBody;
    const snap = BATCH_STORE.get(exec.batch_id);
    if (!snap) {
      return json({ error: 'STALE_DRY_RUN', detail: 'batch_id_unknown_or_expired' }, 200);
    }
    if (snap.actor_user_id !== actorUserId) {
      return json({ error: 'forbidden', detail: 'batch_actor_mismatch' }, 403);
    }

    // Перепроверка состояния перед execute.
    const fresh = await loadSnapshot(supabase, snap.eligible_ids);
    const stillEligible = fresh.filter((i) => i.eligibility === 'eligible').map((i) => i.subscription_v2_id);
    const changed = snap.eligible_ids.filter((id) => !stillEligible.includes(id));

    const results: Array<PerItem & { execute_status: string; stripe_status?: number; detail?: string }> = [];
    let success = 0, skipped = 0, errors = 0;

    for (const item of fresh) {
      if (item.eligibility !== 'eligible') {
        results.push({ ...item, execute_status: 'skipped', detail: item.skip_reason });
        skipped++;
        continue;
      }
      const callRes = await callSingleCancel(authHeader, item.subscription_v2_id, snap.mode);
      const status = callRes.ok ? 'ok' : (callRes.detail.includes('already_canceled') ? 'skipped' : 'error');
      if (status === 'ok') success++;
      else if (status === 'skipped') skipped++;
      else errors++;
      results.push({
        ...item,
        execute_status: status,
        stripe_status: callRes.status,
        detail: callRes.detail,
      });
      // Дать Stripe API передохнуть (rate-limit-safe).
      await new Promise((r) => setTimeout(r, 120));
    }

    await supabase.from('audit_logs').insert({
      action: `admin.subscriptions.bulk_cancel.execute.${snap.mode}`,
      entity_type: 'subscriptions_v2',
      entity_id: null,
      actor_user_id: actorUserId,
      actor_type: 'user',
      actor_label: actorEmail,
      meta: {
        actor_type: 'user',
        actor_label: actorEmail,
        batch_id: snap.batch_id,
        mode: snap.mode,
        reason: exec.reason ?? null,
        selected_count: snap.items.length,
        eligible_count: snap.eligible_ids.length,
        stale_count: changed.length,
        success_count: success,
        skip_count: skipped,
        error_count: errors,
        results,
      },
    });

    // Remove snapshot после execute — повторный execute невозможен.
    BATCH_STORE.delete(snap.batch_id);

    return json({
      ok: errors === 0,
      batch_id: snap.batch_id,
      mode: snap.mode,
      counts: {
        selected: snap.items.length,
        eligible_initial: snap.eligible_ids.length,
        stale: changed.length,
        success,
        skipped,
        errors,
      },
      results,
    });
  }

  // ── DRY-RUN path ───────────────────────────────────────────────────────
  const dr = body as Partial<DryRunBody>;
  if (!Array.isArray(dr.subscription_ids)) {
    return json({ error: 'invalid_body', detail: 'subscription_ids_required' }, 400);
  }
  if (dr.subscription_ids.length === 0) {
    return json({ error: 'invalid_body', detail: 'empty_subscription_ids' }, 400);
  }
  if (dr.subscription_ids.length > MAX_BATCH) {
    return json({ error: 'BATCH_TOO_LARGE', detail: `max=${MAX_BATCH}` }, 400);
  }
  if (!dr.subscription_ids.every(isUuid)) {
    return json({ error: 'invalid_body', detail: 'subscription_ids_not_all_uuid' }, 400);
  }
  if (dr.mode !== 'period_end' && dr.mode !== 'immediate') {
    return json({ error: 'invalid_body', detail: 'mode_must_be_period_end_or_immediate' }, 400);
  }
  const mode: Mode = dr.mode;

  // immediate gate: явно поддержан, но требует второго подтверждения уже на UI/execute step.
  // В RUN 2 запускаем только period_end в production; immediate — операционный путь по экстренной отмене.

  const items = await loadSnapshot(supabase, dr.subscription_ids);
  const eligibleIds = items.filter((i) => i.eligibility === 'eligible').map((i) => i.subscription_v2_id);

  const batchId = crypto.randomUUID();
  BATCH_STORE.set(batchId, {
    batch_id: batchId,
    actor_user_id: actorUserId,
    mode,
    items,
    eligible_ids: eligibleIds,
    created_at: Date.now(),
  });

  await supabase.from('audit_logs').insert({
    action: 'admin.subscriptions.bulk_cancel.dry_run',
    entity_type: 'subscriptions_v2',
    entity_id: null,
    actor_user_id: actorUserId,
    actor_type: 'user',
    actor_label: actorEmail,
    meta: {
      actor_type: 'user',
      actor_label: actorEmail,
      batch_id: batchId,
      mode,
      reason: dr.reason ?? null,
      selected_count: items.length,
      eligible_count: eligibleIds.length,
      skipped_count: items.length - eligibleIds.length,
      items,
    },
  });

  return json({
    ok: true,
    batch_id: batchId,
    expires_in_ms: DRY_RUN_TTL_MS,
    mode,
    counts: {
      selected: items.length,
      eligible: eligibleIds.length,
      skipped: items.length - eligibleIds.length,
    },
    items,
    next_step: {
      method: 'POST',
      body_example: { batch_id: batchId, confirm: true, reason: '<свободный текст>' },
    },
  });
});
