// Phase 3.2 — Stripe Subscription Actions (cancel_at_period_end / cancel_now)
//
// Жёсткие правила (см. .lovable/plan.md → Phase 3.2 v2):
//   - Only provider='stripe'. bePaid → not_supported, без изменений.
//   - dry_run=true ничего не меняет; execute требует super_admin.
//   - Никаких сырых данных карт (PAN/CVC/exp) ни во входе, ни в исходящих
//     Stripe-вызовах. PCI-валидатор отклоняет такие поля HTTP 400.
//   - Доступ не отзываем; entitlements/access_rules/Telegram не трогаем.
//   - Только Stripe API + meta-обновления; webhook сам синхронизирует state.
//   - HTTP 200 + manual_review на любом конфликте; никаких частичных INSERT.
//
// Audit: stripe.subscription_action.{dry_run|execute}.{cancel_at_period_end|cancel_now}

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import { stripeFetch } from '../_shared/acquiring/stripe-client.ts';

type Action = 'cancel_at_period_end' | 'cancel_now';

interface ReqBody {
  subscription_v2_id: string;
  action: Action;
  dry_run?: boolean;
}

// ── PCI guard ──────────────────────────────────────────────────────────────
// Любой намёк на сырые данные карты во входе → HTTP 400, ни одного байта в Stripe.
const PCI_FORBIDDEN_KEYS = new Set([
  'card', 'number', 'card_number', 'cvc', 'cvv',
  'exp_month', 'exp_year', 'expiry', 'expiration',
  'payment_method_data', 'pan',
]);
function pciScan(value: unknown, path = ''): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = pciScan(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PCI_FORBIDDEN_KEYS.has(k.toLowerCase())) return `${path}.${k}`;
      const hit = pciScan(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

function uuidLike(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  // ── 1. PCI guard на сыром payload (даже до auth) ────────────────────────
  const pciHit = pciScan(raw);
  if (pciHit) {
    return json({ error: 'pci_violation', detail: `forbidden_card_field_in_payload:${pciHit}` }, 400);
  }

  // ── 2. Schema ───────────────────────────────────────────────────────────
  const body = raw as Partial<ReqBody>;
  if (!uuidLike(body.subscription_v2_id)) return json({ error: 'invalid_subscription_v2_id' }, 400);
  if (body.action !== 'cancel_at_period_end' && body.action !== 'cancel_now') {
    return json({ error: 'invalid_action' }, 400);
  }
  const dryRun = body.dry_run !== false; // default true

  // ── 3. Auth: super_admin ────────────────────────────────────────────────
  let actor: { user_id: string; email: string | null };
  let supabase: ReturnType<typeof createClient>;
  try {
    const guard = await requireSuperAdmin(req);
    actor = guard.user;
    supabase = guard.supabase;
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg.startsWith('forbidden') ? 'forbidden' : 'unauthorized', detail: msg }, msg.startsWith('forbidden') ? 403 : 401);
  }

  // ── 4. Load subscription + provider linkage ─────────────────────────────
  const { data: subv2, error: subErr } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, product_id, tariff_id, status, access_end_at, canceled_at, cancel_reason, meta')
    .eq('id', body.subscription_v2_id)
    .maybeSingle();
  if (subErr) return json({ error: 'db_error', detail: subErr.message }, 500);
  if (!subv2) return json({ error: 'subscription_not_found' }, 404);

  const { data: provRows, error: provErr } = await supabase
    .from('provider_subscriptions')
    .select('id, provider, provider_subscription_id, state, meta')
    .eq('subscription_v2_id', subv2.id);
  if (provErr) return json({ error: 'db_error', detail: provErr.message }, 500);

  const stripeRow = (provRows ?? []).find((r: any) => r.provider === 'stripe') as any | undefined;
  if (!stripeRow) return json({ error: 'not_supported', detail: 'provider_not_stripe' }, 200);

  const providerSubId: string | null = stripeRow.provider_subscription_id ?? null;
  if (!providerSubId || !providerSubId.startsWith('sub_')) {
    return json({ error: 'manual_review', detail: 'stripe_subscription_id_missing_or_invalid', provider_sub_id: providerSubId }, 200);
  }

  // account_code: SOT = subv2.meta.stripe.account_code (бинд по событию created)
  const subMetaStripe = ((subv2.meta as any)?.stripe ?? {}) as Record<string, unknown>;
  const psMetaStripe  = ((stripeRow.meta as any)?.stripe ?? {}) as Record<string, unknown>;
  const accountCode = (subMetaStripe.account_code ?? psMetaStripe.account_code ?? null) as string | null;
  if (!accountCode) return json({ error: 'manual_review', detail: 'account_code_missing' }, 200);

  // Уже отменена?
  if (subv2.status === 'canceled') {
    return json({ error: 'already_canceled', subscription_v2_id: subv2.id }, 200);
  }
  const alreadyCancelAtPeriodEnd = !!(subMetaStripe.cancel_at_period_end);
  if (body.action === 'cancel_at_period_end' && alreadyCancelAtPeriodEnd) {
    return json({ ok: true, noop: true, reason: 'already_cancel_at_period_end' }, 200);
  }

  const before_state = {
    subv2_status: subv2.status,
    ps_state: stripeRow.state,
    cancel_at_period_end: alreadyCancelAtPeriodEnd,
    canceled_at: subv2.canceled_at,
  };

  // ── 5. Dry-run ──────────────────────────────────────────────────────────
  if (dryRun) {
    await supabase.from('audit_logs').insert({
      action: `stripe.subscription_action.dry_run.${body.action}`,
      entity_type: 'subscriptions_v2',
      entity_id: subv2.id,
      actor_user_id: actor.user_id,
      actor_type: "user",
      actor_label: actor.email,
      meta: {
        actor_type: 'user',
        actor_label: actor.email,
        provider: 'stripe',
        account_code: accountCode,
        provider_subscription_id: providerSubId,
        before_state,
      },
    });
    return json({
      ok: true,
      dry_run: true,
      plan: {
        action: body.action,
        stripe_subscription_id: providerSubId,
        account_code: accountCode,
        before_state,
        will_call: body.action === 'cancel_at_period_end'
          ? 'POST /subscriptions/{id}  cancel_at_period_end=true'
          : 'DELETE /subscriptions/{id}',
        will_change: body.action === 'cancel_at_period_end'
          ? 'subv2.meta.stripe.cancel_at_period_end=true + cancel_requested_at + cancel_source=admin'
          : 'subv2.status=canceled + ps.state=canceled + cancel_reason=admin_stripe_cancel_now',
        access_revoked: false,
        telegram_kick: false,
      },
    });
  }

  // ── 6. Execute → Stripe API ─────────────────────────────────────────────
  let secret: string;
  try {
    secret = await readAcquiringSecret('stripe', accountCode, 'secret_key');
  } catch (e) {
    return json({ error: 'manual_review', detail: `stripe_secret_unavailable:${(e as Error).message}` }, 200);
  }

  const idemKey = `ssa:${subv2.id}:${body.action}:${Date.now()}`;
  let stripeRes;
  if (body.action === 'cancel_at_period_end') {
    stripeRes = await stripeFetch<Record<string, unknown>>(
      `/subscriptions/${encodeURIComponent(providerSubId)}`,
      {
        secret_key: secret,
        method: 'POST',
        formBody: [['cancel_at_period_end', 'true']],
        idempotencyKey: idemKey,
      },
    );
  } else {
    stripeRes = await stripeFetch<Record<string, unknown>>(
      `/subscriptions/${encodeURIComponent(providerSubId)}`,
      { secret_key: secret, method: 'DELETE', idempotencyKey: idemKey },
    );
  }
  if (!stripeRes.ok) {
    await supabase.from('audit_logs').insert({
      action: `stripe.subscription_action.execute.${body.action}.stripe_error`,
      entity_type: 'subscriptions_v2',
      entity_id: subv2.id,
      actor_user_id: actor.user_id,
      actor_type: "user",
      actor_label: actor.email,
      meta: {
        actor_type: 'user',
        actor_label: actor.email,
        provider: 'stripe',
        account_code: accountCode,
        provider_subscription_id: providerSubId,
        stripe_status: stripeRes.status,
        stripe_error: stripeRes.error,
      },
    });
    return json({ error: 'stripe_api_error', status: stripeRes.status, detail: stripeRes.error }, 200);
  }

  // ── 7. Локальный sync (минимальный; полный — на webhook) ────────────────
  const nowIso = new Date().toISOString();
  const newSubMetaStripe = {
    ...subMetaStripe,
    cancel_source: 'admin',
    cancel_requested_at: nowIso,
    cancel_at_period_end: body.action === 'cancel_at_period_end' ? true : (subMetaStripe.cancel_at_period_end ?? false),
    last_admin_action: body.action,
  };
  const subUpdate: Record<string, unknown> = {
    meta: { ...(subv2.meta as object || {}), stripe: newSubMetaStripe },
    updated_at: nowIso,
  };
  if (body.action === 'cancel_now') {
    subUpdate.status = 'canceled';
    subUpdate.canceled_at = nowIso;
    subUpdate.cancel_reason = 'admin_stripe_cancel_now';
    subUpdate.auto_renew = false;
  }
  const { error: updErr } = await supabase
    .from('subscriptions_v2')
    .update(subUpdate)
    .eq('id', subv2.id);
  if (updErr) {
    // Stripe уже принял; помечаем manual_review для last-mile recovery.
    await supabase.from('audit_logs').insert({
      action: `stripe.subscription_action.execute.${body.action}.local_sync_failed`,
      entity_type: 'subscriptions_v2',
      entity_id: subv2.id,
      actor_user_id: actor.user_id,
      actor_type: "user",
      actor_label: actor.email,
      meta: {
        actor_type: 'user',
        actor_label: actor.email,
        provider: 'stripe',
        account_code: accountCode,
        provider_subscription_id: providerSubId,
        db_error: updErr.message,
        note: 'stripe_call_succeeded_but_local_update_failed_webhook_will_sync',
      },
    });
    return json({ error: 'manual_review', detail: 'local_sync_failed', stripe_ok: true }, 200);
  }

  if (body.action === 'cancel_now') {
    await supabase
      .from('provider_subscriptions')
      .update({
        state: 'canceled',
        meta: { ...(stripeRow.meta as object || {}), stripe: { ...psMetaStripe, cancel_source: 'admin', last_admin_action: 'cancel_now' } },
        updated_at: nowIso,
      })
      .eq('id', stripeRow.id);
  } else {
    await supabase
      .from('provider_subscriptions')
      .update({
        meta: { ...(stripeRow.meta as object || {}), stripe: { ...psMetaStripe, cancel_at_period_end: true, cancel_source: 'admin', last_admin_action: 'cancel_at_period_end' } },
        updated_at: nowIso,
      })
      .eq('id', stripeRow.id);
  }

  const after_state = {
    subv2_status: body.action === 'cancel_now' ? 'canceled' : subv2.status,
    ps_state: body.action === 'cancel_now' ? 'canceled' : stripeRow.state,
    cancel_at_period_end: body.action === 'cancel_at_period_end' ? true : alreadyCancelAtPeriodEnd,
  };

  await supabase.from('audit_logs').insert({
    action: `stripe.subscription_action.execute.${body.action}`,
    entity_type: 'subscriptions_v2',
    entity_id: subv2.id,
    actor_user_id: actor.user_id,
      actor_type: "user",
      actor_label: actor.email,
    meta: {
      actor_type: 'user',
      actor_label: actor.email,
      provider: 'stripe',
      account_code: accountCode,
      provider_subscription_id: providerSubId,
      stripe_subscription_id: providerSubId,
      before_state,
      after_state,
      access_preserved: true,
      telegram_kick_skipped: true,
    },
  });

  return json({
    ok: true,
    dry_run: false,
    action: body.action,
    subscription_v2_id: subv2.id,
    stripe_subscription_id: providerSubId,
    before_state,
    after_state,
  });
});
