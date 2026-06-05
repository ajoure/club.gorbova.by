// Phase 3.1 Stage 2 — Stripe Subscription Resolver (SOT)
//
// Единая точка для webhook + (будущих) reconcile/events-replay (D5).
// НЕ HTTP-функция: чистые helpers, принимающие supabase service-role client + event.
//
// Покрывает 5 event-классов:
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.paid
//   - invoice.payment_failed
//
// КЛЮЧЕВОЕ ПРАВИЛО STAGE 2 (зафиксировано пользователем):
//   invoice.paid  = ЕДИНСТВЕННЫЙ activation event
//                   (orders_v2 + payments_v2 + grant-access-for-order).
//   customer.subscription.created  = bind lifecycle only
//   customer.subscription.updated  = sync lifecycle only
//   customer.subscription.deleted  = sync lifecycle only
//   invoice.payment_failed         = grace lifecycle only (no revoke, no CRM fail).
//
// STOP-GATE:
//   - НЕ менять grant-access-for-order (только вызывать).
//   - НЕ трогать entitlements / access_rules напрямую.
//   - НЕ revoke доступ.
//   - НЕ трогать bePaid.
//   - НЕ создавать новых таблиц / RPC / cron.
//   - HTTP 200 + manual_review при любом conflict; никаких INSERT.
//
// Idempotency:
//   - Уровень event = provider_events_idem_unique (вне резолвера, в webhook).
//   - Уровень activation (invoice.paid) = SELECT-before-INSERT по
//     orders_v2.meta->stripe.invoice_id (см. B-2, утверждённый default).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { readAcquiringSecret } from './acquiring/vault.ts';

type SupabaseClient = ReturnType<typeof createClient>;

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  livemode?: boolean;
  account?: string;
}

export interface ResolveResult {
  order_id?: string;
  payment_id?: string;
  subscription_v2_id?: string;
  provider_subscription_id?: string;
  note?: string;
  manual_review?: boolean;
  manual_review_reason?: string;
}

const ZERO_DECIMAL = new Set<string>(['JPY', 'KRW', 'VND']);
function toMajorUnits(minor: number, currency: string): number {
  const cur = currency.toUpperCase();
  if (ZERO_DECIMAL.has(cur)) return minor;
  return Math.round(minor) / 100;
}

// =====================================================================
// Status mapping — Stripe subscription.status → subscriptions_v2.status
// + provider_subscriptions.state. Источник: D2.
// =====================================================================
type SubV2Status = 'pending' | 'active' | 'trial' | 'past_due' | 'canceled' | 'expired' | 'superseded' | 'expired_reentry';
type ProvSubState = 'pending' | 'active' | 'past_due' | 'canceled' | 'expired';

function mapStripeSubStatus(stripeStatus: string): { subv2: SubV2Status | null; prov: ProvSubState | null } {
  switch (stripeStatus) {
    case 'incomplete':           return { subv2: 'pending',  prov: 'pending'  };
    case 'incomplete_expired':   return { subv2: 'canceled', prov: 'canceled' };
    case 'trialing':             return { subv2: 'active',   prov: 'active'   };
    case 'active':               return { subv2: 'active',   prov: 'active'   };
    case 'past_due':             return { subv2: 'past_due', prov: 'past_due' };
    case 'unpaid':               return { subv2: 'past_due', prov: 'past_due' };
    case 'canceled':             return { subv2: 'canceled', prov: 'canceled' };
    case 'paused':               return { subv2: null,       prov: null       }; // not MVP
    default:                     return { subv2: null,       prov: null       };
  }
}

// =====================================================================
// Mandatory audit (DoD): event_id, subscription_v2_id, provider_subscription_id,
// action, result, manual_review, account_code.
// =====================================================================
async function writeAudit(
  supabase: SupabaseClient,
  params: {
    event: StripeEvent;
    account_code: string;
    action: string;
    result: string;
    subscription_v2_id: string | null;
    provider_subscription_id: string | null;
    manual_review?: boolean;
    manual_review_reason?: string | null;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action: params.action,
    actor_type: 'system',
    actor_label: 'stripe-webhook',
    entity_type: params.subscription_v2_id ? 'subscriptions_v2' : 'provider_events',
    entity_id: params.subscription_v2_id ?? null,
    meta: {
      event_id: params.event.id,
      event_type: params.event.type,
      account_code: params.account_code,
      subscription_v2_id: params.subscription_v2_id,
      provider_subscription_id: params.provider_subscription_id,
      result: params.result,
      manual_review: !!params.manual_review,
      manual_review_reason: params.manual_review_reason ?? null,
      ...(params.extra ?? {}),
    },
  });
}

// =====================================================================
// Cross-account guard. Returns true if conflict.
// =====================================================================
function isCrossAccountConflict(subMetaAccountCode: string | null, eventAccountCode: string): boolean {
  if (!subMetaAccountCode) return false; // legacy/missing → не блокируем
  return subMetaAccountCode !== eventAccountCode;
}

function readSubscriptionMetadata(obj: Record<string, unknown>): Record<string, string> {
  const md = (obj.metadata ?? {}) as Record<string, string>;
  return md;
}

// =====================================================================
// Lookups
// =====================================================================
async function findSubByStripeId(supabase: SupabaseClient, stripeSubId: string) {
  const { data, error } = await supabase
    .from('provider_subscriptions')
    .select('id, subscription_v2_id, provider_subscription_id, state, meta, order_id')
    .eq('provider', 'stripe')
    .eq('provider_subscription_id', stripeSubId)
    .maybeSingle();
  if (error) throw new Error(`findSubByStripeId: ${error.message}`);
  return data as any | null;
}

async function findPendingSub(supabase: SupabaseClient, subv2Id: string) {
  const { data, error } = await supabase
    .from('provider_subscriptions')
    .select('id, subscription_v2_id, provider_subscription_id, state, meta')
    .eq('provider', 'stripe')
    .eq('subscription_v2_id', subv2Id)
    .eq('state', 'pending')
    .eq('provider_subscription_id', `pending:${subv2Id}`)
    .maybeSingle();
  if (error) throw new Error(`findPendingSub: ${error.message}`);
  return data as any | null;
}

async function loadSubV2(supabase: SupabaseClient, subv2Id: string) {
  const { data, error } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, product_id, tariff_id, status, meta, access_start_at, access_end_at, billing_type')
    .eq('id', subv2Id)
    .maybeSingle();
  if (error) throw new Error(`loadSubV2: ${error.message}`);
  return data as any | null;
}

function mergeSubMetaStripe(currentMeta: any, patch: Record<string, unknown>): Record<string, unknown> {
  const cur = (currentMeta && typeof currentMeta === 'object') ? currentMeta as Record<string, unknown> : {};
  const curStripe = (cur.stripe && typeof cur.stripe === 'object') ? cur.stripe as Record<string, unknown> : {};
  const nextStripe = { ...curStripe, ...patch };
  return { ...cur, stripe: nextStripe };
}

// =====================================================================
// C.1 — customer.subscription.created
// =====================================================================
async function onSubscriptionCreated(
  supabase: SupabaseClient,
  event: StripeEvent,
  account_code: string,
): Promise<ResolveResult> {
  const sub = event.data.object as Record<string, unknown>;
  const stripeSubId = sub.id as string;
  const md = readSubscriptionMetadata(sub);
  const subv2_id = md.subscription_v2_id ?? null;
  const meta_account_code = md.account_code ?? null;

  if (!subv2_id) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.created.no_pre_created_sub',
      result: 'manual_review',
      subscription_v2_id: null, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'no_pre_created_sub',
      extra: { metadata: md },
    });
    return { note: 'no_pre_created_sub', manual_review: true, manual_review_reason: 'no_pre_created_sub' };
  }

  // Cross-account guard
  if (meta_account_code && meta_account_code !== account_code) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.created.foreign_account',
      result: 'manual_review',
      subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'foreign_account',
      extra: { meta_account_code },
    });
    return { subscription_v2_id: subv2_id, note: 'foreign_account', manual_review: true, manual_review_reason: 'foreign_account' };
  }

  // Zombie pending guard: subv2 must NOT be terminal.
  const subv2 = await loadSubV2(supabase, subv2_id);
  if (!subv2) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.created.subv2_missing',
      result: 'manual_review',
      subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'subv2_missing',
    });
    return { subscription_v2_id: subv2_id, note: 'subv2_missing', manual_review: true };
  }
  const TERMINAL = new Set(['canceled', 'expired', 'superseded', 'expired_reentry']);
  if (TERMINAL.has(subv2.status as string)) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.created.zombie_pending',
      result: 'manual_review',
      subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'zombie_pending_subscription',
      extra: { subv2_status: subv2.status },
    });
    return { subscription_v2_id: subv2_id, note: 'zombie_pending', manual_review: true, manual_review_reason: 'zombie_pending_subscription' };
  }

  const pending = await findPendingSub(supabase, subv2_id);
  if (!pending) {
    // Может быть уже bind'нут — проверим по stripeSubId.
    const existing = await findSubByStripeId(supabase, stripeSubId);
    if (existing) {
      // idempotent re-delivery → noop
      await writeAudit(supabase, {
        event, account_code,
        action: 'stripe.subscription.created.already_bound',
        result: 'noop',
        subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
      });
      return { subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId, note: 'already_bound' };
    }
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.created.no_pre_created_sub',
      result: 'manual_review',
      subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'no_pre_created_sub',
    });
    return { subscription_v2_id: subv2_id, note: 'no_pre_created_sub', manual_review: true, manual_review_reason: 'no_pre_created_sub' };
  }

  // BIND ONLY — Stage 2 contract: до первого успешного invoice.paid
  // provider_subscriptions.state НИКОГДА не становится 'active'.
  // Если subv2 ещё pending → принудительно держим pending (даже если Stripe sub.status='active'/'trialing').
  // Терминальные стейты (canceled/past_due) синхронизируем как есть.
  const stripeStatus = String(sub.status ?? 'incomplete');
  const mapped = mapStripeSubStatus(stripeStatus);
  let provState: ProvSubState;
  if (subv2.status === 'pending') {
    if (mapped.prov === 'canceled' || mapped.prov === 'past_due') {
      provState = mapped.prov;
    } else {
      // 'active' / 'trialing' / 'pending' / null → bind-only pending.
      provState = 'pending';
    }
  } else {
    provState = mapped.prov ?? 'pending';
  }

  await supabase
    .from('provider_subscriptions')
    .update({
      provider_subscription_id: stripeSubId,
      state: provState,
      next_charge_at: sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toISOString() : null,
      meta: {
        ...(pending.meta ?? {}),
        stripe: {
          ...(((pending.meta as any)?.stripe ?? {})),
          subscription_id: stripeSubId,
          customer_id: sub.customer ?? null,
          current_period_start: sub.current_period_start ?? null,
          current_period_end: sub.current_period_end ?? null,
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
          default_payment_method: sub.default_payment_method ?? null,
          collection_method: sub.collection_method ?? null,
          status: stripeStatus,
        },
        stage: 'bound_lifecycle',
        binding_only_no_activation: subv2.status === 'pending',
      },
    })
    .eq('id', pending.id);

  // Update subv2.meta.stripe.* — статус НЕ меняем (это сделает invoice.paid).
  const newSubMeta = mergeSubMetaStripe(subv2.meta, {
    subscription_id: stripeSubId,
    customer_id: sub.customer ?? null,
    current_period_start: sub.current_period_start ?? null,
    current_period_end: sub.current_period_end ?? null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    default_payment_method: sub.default_payment_method ?? null,
    collection_method: sub.collection_method ?? null,
    status: stripeStatus,
  });
  await supabase.from('subscriptions_v2').update({ meta: newSubMeta }).eq('id', subv2_id);

  await writeAudit(supabase, {
    event, account_code,
    action: 'stripe.subscription.created.bound',
    result: 'ok',
    subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
    extra: { stripe_status: stripeStatus, prov_state: provState },
  });

  return { subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId, note: 'bound' };
}

// =====================================================================
// C.2 — customer.subscription.updated  (sync only, no access)
// =====================================================================
async function onSubscriptionUpdated(
  supabase: SupabaseClient,
  event: StripeEvent,
  account_code: string,
): Promise<ResolveResult> {
  const sub = event.data.object as Record<string, unknown>;
  const stripeSubId = sub.id as string;
  const md = readSubscriptionMetadata(sub);
  const subv2_id = md.subscription_v2_id ?? null;

  const ps = await findSubByStripeId(supabase, stripeSubId);
  if (!ps) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.updated.unknown_sub',
      result: 'manual_review',
      subscription_v2_id: subv2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'unknown_subscription',
    });
    return { provider_subscription_id: stripeSubId, note: 'unknown_subscription', manual_review: true };
  }

  const subv2 = await loadSubV2(supabase, ps.subscription_v2_id);
  if (!subv2) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.updated.subv2_missing',
      result: 'manual_review',
      subscription_v2_id: ps.subscription_v2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'subv2_missing',
    });
    return { subscription_v2_id: ps.subscription_v2_id, note: 'subv2_missing', manual_review: true };
  }

  const subMetaAccount = (((subv2.meta as any)?.stripe ?? {}).account_code as string | null) ?? null;
  if (isCrossAccountConflict(subMetaAccount, account_code)) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.updated.foreign_account',
      result: 'manual_review',
      subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'foreign_account',
      extra: { sub_account_code: subMetaAccount },
    });
    return { subscription_v2_id: subv2.id, note: 'foreign_account', manual_review: true };
  }

  const stripeStatus = String(sub.status ?? 'active');
  const mapped = mapStripeSubStatus(stripeStatus);

  // Update provider_subscriptions snapshot
  await supabase
    .from('provider_subscriptions')
    .update({
      state: mapped.prov ?? ps.state,
      next_charge_at: sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toISOString() : null,
      meta: {
        ...((ps.meta as any) ?? {}),
        stripe: {
          ...((((ps.meta as any)?.stripe) ?? {})),
          current_period_start: sub.current_period_start ?? null,
          current_period_end: sub.current_period_end ?? null,
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
          default_payment_method: sub.default_payment_method ?? null,
          status: stripeStatus,
        },
      },
    })
    .eq('id', ps.id);

  // Update subv2.meta.stripe + status (если pending → НЕ трогаем; activation = invoice.paid).
  const newSubMeta = mergeSubMetaStripe(subv2.meta, {
    current_period_start: sub.current_period_start ?? null,
    current_period_end: sub.current_period_end ?? null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    default_payment_method: sub.default_payment_method ?? null,
    status: stripeStatus,
  });

  const subUpdate: Record<string, unknown> = { meta: newSubMeta };
  // Sync subv2.status только если уже не pending (pending → активирует invoice.paid).
  if (subv2.status !== 'pending' && mapped.subv2 && mapped.subv2 !== subv2.status) {
    subUpdate.status = mapped.subv2;
    if (mapped.subv2 === 'canceled') {
      subUpdate.cancel_reason = 'stripe_subscription_status_canceled';
      subUpdate.canceled_at = new Date().toISOString();
    }
  }
  await supabase.from('subscriptions_v2').update(subUpdate).eq('id', subv2.id);

  await writeAudit(supabase, {
    event, account_code,
    action: 'stripe.subscription.updated.synced',
    result: 'ok',
    subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
    extra: { stripe_status: stripeStatus, prov_state: mapped.prov, subv2_status_after: subUpdate.status ?? subv2.status },
  });
  return { subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId, note: 'synced' };
}

// =====================================================================
// C.3 — customer.subscription.deleted  (cancel, NO revoke)
// =====================================================================
async function onSubscriptionDeleted(
  supabase: SupabaseClient,
  event: StripeEvent,
  account_code: string,
): Promise<ResolveResult> {
  const sub = event.data.object as Record<string, unknown>;
  const stripeSubId = sub.id as string;

  const ps = await findSubByStripeId(supabase, stripeSubId);
  if (!ps) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.subscription.deleted.unknown_sub',
      result: 'manual_review',
      subscription_v2_id: null, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'unknown_subscription',
    });
    return { provider_subscription_id: stripeSubId, note: 'unknown_subscription', manual_review: true };
  }

  const subv2 = await loadSubV2(supabase, ps.subscription_v2_id);
  if (subv2) {
    const subMetaAccount = (((subv2.meta as any)?.stripe ?? {}).account_code as string | null) ?? null;
    if (isCrossAccountConflict(subMetaAccount, account_code)) {
      await writeAudit(supabase, {
        event, account_code,
        action: 'stripe.subscription.deleted.foreign_account',
        result: 'manual_review',
        subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
        manual_review: true, manual_review_reason: 'foreign_account',
      });
      return { subscription_v2_id: subv2.id, note: 'foreign_account', manual_review: true };
    }
  }

  await supabase
    .from('provider_subscriptions')
    .update({
      state: 'canceled',
      meta: {
        ...((ps.meta as any) ?? {}),
        stripe: { ...((((ps.meta as any)?.stripe) ?? {})), status: 'canceled', deleted_at: new Date().toISOString() },
      },
    })
    .eq('id', ps.id);

  if (subv2 && subv2.status !== 'canceled') {
    await supabase
      .from('subscriptions_v2')
      .update({
        status: 'canceled',
        cancel_reason: 'stripe_subscription_deleted',
        canceled_at: new Date().toISOString(),
        auto_renew: false,
      })
      .eq('id', subv2.id);
  }

  await writeAudit(supabase, {
    event, account_code,
    action: 'stripe.subscription.deleted.canceled',
    result: 'ok',
    subscription_v2_id: subv2?.id ?? ps.subscription_v2_id, provider_subscription_id: stripeSubId,
    extra: { access_preserved_until_entitlements_expiry: true },
  });

  return { subscription_v2_id: subv2?.id ?? ps.subscription_v2_id, provider_subscription_id: stripeSubId, note: 'canceled_no_revoke' };
}

// =====================================================================
// C.4 — invoice.paid  (ONLY activation path)
// =====================================================================
async function onInvoicePaid(
  supabase: SupabaseClient,
  event: StripeEvent,
  account_code: string,
): Promise<ResolveResult> {
  const invoice = event.data.object as Record<string, unknown>;
  const invoice_id = invoice.id as string;
  // Stripe API 2026-04+ moved `subscription` под `invoice.parent.subscription_details.subscription`.
  // Дополнительно ищем в lines[0].parent.subscription_item_details.subscription как fallback.
  const linesData0 = ((((invoice.lines as any) ?? {}).data ?? [])[0] ?? null) as any;
  const parentSubDetails = ((invoice.parent as any)?.subscription_details ?? null) as any;
  const stripeSubId =
    ((invoice.subscription as string | null) ?? null)
    ?? (parentSubDetails?.subscription as string | null)
    ?? (linesData0?.parent?.subscription_item_details?.subscription as string | null)
    ?? null;
  const pi_id = (invoice.payment_intent as string | null) ?? null;
  const amount_paid_minor = Number(invoice.amount_paid ?? 0);
  const currency = String(invoice.currency ?? 'usd').toUpperCase();
  const amount_major = toMajorUnits(amount_paid_minor, currency);

  if (!stripeSubId) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.no_subscription',
      result: 'manual_review',
      subscription_v2_id: null, provider_subscription_id: null,
      manual_review: true, manual_review_reason: 'unknown_invoice_no_subscription',
      extra: { invoice_id },
    });
    return { note: 'unknown_invoice_no_subscription', manual_review: true };
  }

  // ---- Idempotency: invoice.id already materialized? ----
  const { data: existingOrders, error: existErr } = await supabase
    .from('orders_v2')
    .select('id, status, paid_amount')
    .filter('meta->stripe->>invoice_id', 'eq', invoice_id)
    .limit(1);
  if (existErr) {
    throw new Error(`invoice_paid_idem_check: ${existErr.message}`);
  }
  if (existingOrders && existingOrders.length > 0) {
    const existingOrder = existingOrders[0] as any;
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.duplicate',
      result: 'noop',
      subscription_v2_id: null, provider_subscription_id: stripeSubId,
      extra: { invoice_id, existing_order_id: existingOrder.id },
    });
    return { order_id: existingOrder.id, note: 'invoice_paid_duplicate' };
  }

  // ---- Resolve subv2 (order-independent: tolerate invoice.paid arriving BEFORE customer.subscription.created) ----
  let ps = await findSubByStripeId(supabase, stripeSubId);
  let rebound_from_pending = false;
  if (!ps) {
    // RACE: customer.subscription.created ещё не прилетел (или потерян). Резолвим subv2_id из:
    //   1) invoice.subscription_details.metadata.subscription_v2_id (Stripe инжектит metadata подписки)
    //   2) line.metadata.subscription_v2_id
    //   3) Stripe API: GET /v1/subscriptions/{id} → metadata.subscription_v2_id
    const linesPeek = (((invoice.lines as any) ?? {}).data ?? []) as Array<any>;
    const subDetails = (invoice.subscription_details as any) ?? null;
    // Stripe API 2026-04+: metadata лежит в invoice.parent.subscription_details.metadata.
    const parentSubDetails2 = ((invoice.parent as any)?.subscription_details ?? null) as any;
    let subv2_id_hint: string | null =
      (subDetails?.metadata?.subscription_v2_id as string | null)
      ?? (parentSubDetails2?.metadata?.subscription_v2_id as string | null)
      ?? (linesPeek[0]?.metadata?.subscription_v2_id as string | null)
      ?? null;
    let hint_source = subv2_id_hint ? 'invoice_metadata' : null;

    if (!subv2_id_hint) {
      try {
        const sk = await readAcquiringSecret('stripe', account_code, 'secret_key');
        if (sk) {
          const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
            headers: { Authorization: `Bearer ${sk}` },
          });
          if (resp.ok) {
            const subObj = await resp.json();
            subv2_id_hint = (subObj?.metadata?.subscription_v2_id as string | null) ?? null;
            hint_source = subv2_id_hint ? 'stripe_api_subscription_metadata' : null;
          } else {
            await resp.text().catch(() => '');
          }
        }
      } catch (e) {
        await writeAudit(supabase, {
          event, account_code,
          action: 'stripe.invoice.paid.rebind_api_lookup_failed',
          result: 'logged',
          subscription_v2_id: null, provider_subscription_id: stripeSubId,
          extra: { invoice_id, error: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    if (subv2_id_hint) {
      const pending = await findPendingSub(supabase, subv2_id_hint);
      if (pending) {
        // Rebind pending row IN PLACE. state остаётся 'pending' — активация ниже единым путём.
        await supabase
          .from('provider_subscriptions')
          .update({
            provider_subscription_id: stripeSubId,
            meta: {
              ...((pending.meta as any) ?? {}),
              stripe: {
                ...((((pending.meta as any)?.stripe) ?? {})),
                subscription_id: stripeSubId,
                customer_id: invoice.customer ?? null,
              },
              stage: 'bound_via_invoice_paid_race',
              rebind_hint_source: hint_source,
            },
          })
          .eq('id', pending.id);
        ps = await findSubByStripeId(supabase, stripeSubId);
        rebound_from_pending = true;
        await writeAudit(supabase, {
          event, account_code,
          action: 'stripe.invoice.paid.rebound_pre_created_sub',
          result: 'ok',
          subscription_v2_id: subv2_id_hint, provider_subscription_id: stripeSubId,
          extra: { invoice_id, hint_source, race: 'invoice_paid_before_subscription_created' },
        });
      }
    }
  }

  if (!ps) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.unknown_sub',
      result: 'manual_review',
      subscription_v2_id: null, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'unknown_subscription',
      extra: { invoice_id },
    });
    return { provider_subscription_id: stripeSubId, note: 'unknown_subscription', manual_review: true };
  }
  const subv2 = await loadSubV2(supabase, ps.subscription_v2_id);
  if (!subv2) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.subv2_missing',
      result: 'manual_review',
      subscription_v2_id: ps.subscription_v2_id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'subv2_missing',
      extra: { invoice_id },
    });
    return { subscription_v2_id: ps.subscription_v2_id, note: 'subv2_missing', manual_review: true };
  }

  // Cross-account guard
  const subMetaStripe = ((subv2.meta as any)?.stripe ?? {}) as Record<string, unknown>;
  const subAccount = (subMetaStripe.account_code as string | null) ?? null;
  if (isCrossAccountConflict(subAccount, account_code)) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.foreign_account',
      result: 'manual_review',
      subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'foreign_account',
      extra: { invoice_id, sub_account_code: subAccount },
    });
    return { subscription_v2_id: subv2.id, note: 'foreign_account', manual_review: true };
  }

  // Resolve offer_id from invoice line price → tariff_offers.meta.stripe.price_id.
  const lines = (((invoice.lines as any) ?? {}).data ?? []) as Array<any>;
  const firstLine = lines[0] ?? null;
  const linePriceId = firstLine?.price?.id ?? subMetaStripe.price_id ?? null;
  let offer_id: string | null = null;
  if (linePriceId) {
    const { data: offerRow } = await supabase
      .from('tariff_offers')
      .select('id')
      .eq('tariff_id', subv2.tariff_id)
      .filter('meta->stripe->>price_id', 'eq', linePriceId as string)
      .limit(1)
      .maybeSingle();
    offer_id = (offerRow as any)?.id ?? null;
  }

  // ---- Materialize orders_v2 (activation write-path) ----
  const order_number = `STRIPE-${invoice_id}`.slice(0, 64);
  const orderInsert = {
    user_id: subv2.user_id,
    product_id: subv2.product_id,
    tariff_id: subv2.tariff_id,
    offer_id,
    order_number,
    status: 'paid',
    final_price: amount_major,
    paid_amount: amount_major,
    currency,
    provider: 'stripe',
    provider_payment_id: pi_id ?? invoice_id,
    payer_type: 'individual',
    meta: {
      stripe: {
        invoice_id,
        subscription_id: stripeSubId,
        payment_intent_id: pi_id,
        customer_id: invoice.customer ?? null,
        account_code,
        price_id: linePriceId,
        period_start: invoice.period_start ?? null,
        period_end: invoice.period_end ?? null,
        billing_reason: invoice.billing_reason ?? null,
      },
      tracking_id: `stripe_sub:${stripeSubId}:invoice:${invoice_id}`,
      subscription_v2_id: subv2.id,
      provider_subscription_row_id: ps.id,
      source: 'stripe.invoice.paid',
    },
  };

  const { data: orderCreated, error: orderErr } = await supabase
    .from('orders_v2')
    .insert(orderInsert)
    .select('id')
    .single();
  if (orderErr || !orderCreated) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.order_insert_failed',
      result: 'error',
      subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
      extra: { invoice_id, error: orderErr?.message ?? 'unknown' },
    });
    throw new Error(`orders_v2 insert failed: ${orderErr?.message}`);
  }
  const order_id = (orderCreated as any).id as string;

  // ---- payments_v2 ----
  let payment_id: string | undefined;
  if (pi_id) {
    const { data: existingP } = await supabase
      .from('payments_v2')
      .select('id')
      .eq('provider_payment_id', pi_id)
      .maybeSingle();
    if (existingP) {
      payment_id = (existingP as any).id;
    } else {
      const { data: pIns } = await supabase
        .from('payments_v2')
        .insert({
          order_id,
          provider: 'stripe',
          provider_payment_id: pi_id,
          amount: amount_major,
          currency,
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          meta: {
            stripe: { invoice_id, subscription_id: stripeSubId, payment_intent_id: pi_id, account_code, source: 'invoice.paid' },
          },
        })
        .select('id')
        .maybeSingle();
      payment_id = (pIns as any)?.id;
    }
  }

  // ---- Link order_id back to provider_subscriptions + promote state pending→active.
  // Stage 2 contract: invoice.paid — ЕДИНСТВЕННЫЙ путь активации provider_subscriptions.state.
  const provStateNext: ProvSubState = (ps.state === 'pending' || ps.state === 'past_due') ? 'active' : (ps.state as ProvSubState);
  await supabase
    .from('provider_subscriptions')
    .update({
      order_id,
      state: provStateNext,
      last_charge_at: new Date().toISOString(),
      meta: {
        ...((ps.meta as any) ?? {}),
        stripe: { ...((((ps.meta as any)?.stripe) ?? {})), last_invoice_id: invoice_id },
        activated_by_invoice_paid: ps.state === 'pending' ? invoice_id : ((ps.meta as any)?.activated_by_invoice_paid ?? null),
      },
    })
    .eq('id', ps.id);

  // ---- Promote subv2.status pending → active (первая оплата) ----
  if (subv2.status === 'pending') {
    await supabase
      .from('subscriptions_v2')
      .update({ status: 'active', order_id })
      .eq('id', subv2.id);
  } else if (!(subv2 as any).order_id) {
    // Sync order_id если ещё не выставлен.
    await supabase.from('subscriptions_v2').update({ order_id }).eq('id', subv2.id);
  }

  // ---- Call grant-access-for-order (canonical write-path) ----
  const { error: grantErr } = await supabase.functions.invoke('grant-access-for-order', {
    body: { order_id, source: 'stripe_webhook_invoice_paid', provider: 'stripe' },
  });
  if (grantErr) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.paid.grant_access_failed',
      result: 'error',
      subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
      extra: { invoice_id, order_id, error: grantErr.message },
    });
    // Не throw — order уже создан, grant ретраится через nightly reconcile.
  }

  await writeAudit(supabase, {
    event, account_code,
    action: 'stripe.invoice.paid.activated',
    result: 'ok',
    subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
    extra: {
      invoice_id, order_id, payment_id,
      amount: amount_major, currency, price_id: linePriceId, offer_id,
      first_payment: subv2.status === 'pending',
      rebound_from_pending,
      prov_state_before: ps.state, prov_state_after: provStateNext,
    },
  });

  return {
    order_id, payment_id,
    subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
    note: 'activated',
  };
}

// =====================================================================
// C.5 — invoice.payment_failed  (grace; no revoke; no CRM fail)
// =====================================================================
async function onInvoicePaymentFailed(
  supabase: SupabaseClient,
  event: StripeEvent,
  account_code: string,
): Promise<ResolveResult> {
  const invoice = event.data.object as Record<string, unknown>;
  const invoice_id = invoice.id as string;
  const stripeSubId = (invoice.subscription as string | null) ?? null;

  if (!stripeSubId) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.payment_failed.no_subscription',
      result: 'logged',
      subscription_v2_id: null, provider_subscription_id: null,
      extra: { invoice_id },
    });
    return { note: 'no_subscription_logged' };
  }

  const ps = await findSubByStripeId(supabase, stripeSubId);
  if (!ps) {
    await writeAudit(supabase, {
      event, account_code,
      action: 'stripe.invoice.payment_failed.unknown_sub',
      result: 'manual_review',
      subscription_v2_id: null, provider_subscription_id: stripeSubId,
      manual_review: true, manual_review_reason: 'unknown_subscription',
      extra: { invoice_id },
    });
    return { provider_subscription_id: stripeSubId, note: 'unknown_subscription', manual_review: true };
  }
  const subv2 = await loadSubV2(supabase, ps.subscription_v2_id);
  if (!subv2) {
    return { subscription_v2_id: ps.subscription_v2_id, note: 'subv2_missing' };
  }

  // Sync state → past_due (если был active). Pending → НЕ трогаем.
  if (subv2.status === 'active') {
    await supabase.from('subscriptions_v2').update({ status: 'past_due' }).eq('id', subv2.id);
  }
  if (ps.state === 'active') {
    await supabase.from('provider_subscriptions').update({ state: 'past_due' }).eq('id', ps.id);
  }

  await writeAudit(supabase, {
    event, account_code,
    action: 'stripe.invoice.payment_failed.grace',
    result: 'ok',
    subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
    extra: {
      invoice_id,
      attempt_count: invoice.attempt_count ?? null,
      next_payment_attempt: invoice.next_payment_attempt ?? null,
      access_preserved: true,
      crm_stage_failed_skipped: true,
    },
  });
  return { subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId, note: 'grace_no_revoke' };
}

// =====================================================================
// Public dispatcher
// =====================================================================
export async function resolveStripeSubscriptionEvent(
  supabase: SupabaseClient,
  event: StripeEvent,
  account_code: string,
): Promise<ResolveResult | null> {
  switch (event.type) {
    case 'customer.subscription.created':       return onSubscriptionCreated(supabase, event, account_code);
    case 'customer.subscription.updated':       return onSubscriptionUpdated(supabase, event, account_code);
    case 'customer.subscription.deleted':       return onSubscriptionDeleted(supabase, event, account_code);
    case 'invoice.paid':                        return onInvoicePaid(supabase, event, account_code);
    case 'invoice.payment_failed':              return onInvoicePaymentFailed(supabase, event, account_code);
    default:                                    return null;
  }
}

export const STRIPE_SUBSCRIPTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);
