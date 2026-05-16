// PATCH H2.1b-i — 3DS finalize writer extension
// Self-contained handler for `context: '3ds_finalize'` payloads to
// grant-access-for-order. Implements multi-candidate guard, past_due reattach,
// proration on tariff change, trial bootstrap, extendFromDate resolver and
// nextChargeAt suggestion (returned, NOT written — provider-sync stays in
// bepaid-webhook). Backward-compat: NOT invoked unless body.context === '3ds_finalize'.
//
// SCOPE: writer-only. No changes to bepaid-webhook in this patch (H2.1b-ii later).

export type ThreeDsOutcome =
  | {
      kind: "ok";
      subscription_id: string;
      access_end_at: string;
      next_charge_at_suggested: string | null;
    }
  | {
      kind: "bootstrap_created";
      subscription_id: string;
      access_end_at: string;
      next_charge_at_suggested: string | null;
      bootstrap: "trial" | "recurring";
    }
  | {
      kind: "extended";
      subscription_id: string;
      access_end_at: string;
      extended_by_days: number;
      next_charge_at_suggested: string | null;
      extend_from_reason: ExtendFromReason;
    }
  | {
      kind: "manual_review_multi_candidate";
      candidate_ids: string[];
    }
  | {
      kind:
        | "skip_already_processed"
        | "skip_tariff_mismatch"
        | "skip_no_order"
        | "skip_inactive_offer";
      reason?: string;
    }
  | { kind: "error"; reason: string };

export type ExtendFromReason =
  | "same_tariff_from_end"
  | "past_due_reattach_from_max"
  | "tariff_change_from_now"
  | "trial_from_trial_end"
  | "new_from_now";

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// Pure helpers (deterministically testable, no DB)
// ============================================================

export interface TariffShape {
  id: string;
  access_days: number;
  amount?: number | null;
}

export interface SubShape {
  id: string;
  status: string; // active | past_due | trialing | canceled | ...
  tariff_id: string | null;
  access_end_at: string | null;
  meta?: Record<string, unknown> | null;
}

export interface OrderShape {
  id: string;
  user_id: string;
  product_id: string;
  tariff_id: string | null;
  is_trial?: boolean | null;
  trial_end_at?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Decide extendFromDate for 3DS finalize.
 * - active + same tariff → access_end_at (продление от конца)
 * - past_due reattach → max(now, access_end_at)
 * - tariff change → now (proration уже учла остаток)
 * - trial bootstrap → trial_end_at
 * - new sub → now
 */
export function resolveExtendFromDate(
  sub: SubShape | null,
  order: OrderShape,
  now: Date,
): { extendFromDate: Date; reason: ExtendFromReason } {
  if (!sub) {
    if (order.is_trial && order.trial_end_at) {
      return { extendFromDate: new Date(order.trial_end_at), reason: "trial_from_trial_end" };
    }
    return { extendFromDate: now, reason: "new_from_now" };
  }
  const subEnd = sub.access_end_at ? new Date(sub.access_end_at) : null;
  if (sub.status === "past_due") {
    const base = subEnd && subEnd.getTime() > now.getTime() ? subEnd : now;
    return { extendFromDate: base, reason: "past_due_reattach_from_max" };
  }
  if (sub.tariff_id && order.tariff_id && sub.tariff_id !== order.tariff_id) {
    return { extendFromDate: now, reason: "tariff_change_from_now" };
  }
  if (subEnd && subEnd.getTime() > now.getTime()) {
    return { extendFromDate: subEnd, reason: "same_tariff_from_end" };
  }
  return { extendFromDate: now, reason: "new_from_now" };
}

/**
 * Proration: bonus days when switching tariffs mid-cycle.
 * bonus = round(remainingDays * (oldAmount / newAmount))
 * Returns 0 if any amount is missing/zero.
 */
export function applyProration(
  activeSub: SubShape,
  oldTariff: TariffShape,
  newTariff: TariffShape,
  now: Date,
): { remaining_days: number; bonus_days: number } {
  if (!activeSub.access_end_at) return { remaining_days: 0, bonus_days: 0 };
  const end = new Date(activeSub.access_end_at).getTime();
  const remainingDays = Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
  const oldAmount = Number(oldTariff.amount ?? 0);
  const newAmount = Number(newTariff.amount ?? 0);
  if (!oldAmount || !newAmount) return { remaining_days: remainingDays, bonus_days: 0 };
  const bonus = Math.round(remainingDays * (oldAmount / newAmount));
  return { remaining_days: remainingDays, bonus_days: bonus };
}

/**
 * For trial bootstrap: compute access_end_at = trial_end_at, status='trialing'.
 */
export function bootstrapTrial(order: OrderShape): {
  access_end_at: string;
  status: "trialing";
} | null {
  if (!order.is_trial || !order.trial_end_at) return null;
  return { access_end_at: order.trial_end_at, status: "trialing" };
}

/**
 * nextChargeAt offset: 1d before access_end_at for trial, 3d for recurring.
 * Writer returns this value; webhook writes it to provider-sync fields.
 */
export function computeNextChargeAt(
  accessEndAt: Date,
  isTrial: boolean,
): { next_charge_at: string; offset_days: number; reason: string } {
  const offset = isTrial ? 1 : 3;
  const next = new Date(accessEndAt.getTime() - offset * DAY_MS);
  return {
    next_charge_at: next.toISOString(),
    offset_days: offset,
    reason: isTrial ? "trial_minus_1d" : "recurring_minus_3d",
  };
}

/**
 * Multi-candidate guard: classify subscriptions for (user_id, product_id).
 * Returns { candidates, decision }:
 *  - 0 → 'create_new'
 *  - 1 → 'single' (caller decides extend/reattach by status+tariff)
 *  - >1 → 'multi_review'
 */
export function classifyCandidates(subs: SubShape[]): {
  decision: "create_new" | "single" | "multi_review";
  candidates: SubShape[];
} {
  const live = subs.filter((s) =>
    ["active", "past_due", "trialing"].includes(s.status)
  );
  if (live.length === 0) return { decision: "create_new", candidates: [] };
  if (live.length === 1) return { decision: "single", candidates: live };
  return { decision: "multi_review", candidates: live };
}

// ============================================================
// Handler (uses supabase service-role client)
// ============================================================

type Sb = {
  from: (t: string) => any;
};

export interface ThreeDsHandlerDeps {
  supabase: Sb;
  now?: Date;
  audit?: (action: string, meta: Record<string, unknown>) => Promise<void>;
}

/**
 * Main entrypoint. Called from index.ts when body.context === '3ds_finalize'.
 * Returns a structured outcome; caller wraps as HTTP 200 response.
 *
 * Contract:
 * - Reads orders_v2, subscriptions_v2, tariffs.
 * - Writes ONLY to subscriptions_v2 (insert/update) — entitlements are handled
 *   by the existing primary writer path (caller may follow-up; here we focus
 *   on subscription bootstrap/extension semantics).
 * - Does NOT write next_charge_at (returned as suggestion only).
 * - Does NOT call telegram-grant-access directly.
 */
export async function handleThreeDsFinalize(
  orderId: string,
  deps: ThreeDsHandlerDeps,
): Promise<ThreeDsOutcome> {
  const supabase = deps.supabase;
  const now = deps.now ?? new Date();
  const audit = deps.audit ?? (async () => {});

  // 1) Load order
  const { data: order, error: orderErr } = await supabase
    .from("orders_v2")
    .select("id, user_id, product_id, tariff_id, is_trial, trial_end_at, status, meta")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) return { kind: "error", reason: `order_load: ${orderErr.message}` };
  if (!order) return { kind: "skip_no_order", reason: "order_not_found" };
  if (order.status !== "paid") {
    return { kind: "skip_inactive_offer", reason: `order_status=${order.status}` };
  }

  // 2) Idempotency: this order_id already attached to a subscription?
  const { data: alreadyAttached } = await supabase
    .from("subscriptions_v2")
    .select("id, access_end_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (alreadyAttached) {
    return {
      kind: "skip_already_processed",
      reason: `attached_to_subscription:${alreadyAttached.id}`,
    };
  }

  // 3) Candidates
  const { data: subsRaw } = await supabase
    .from("subscriptions_v2")
    .select("id, status, tariff_id, access_end_at, meta")
    .eq("user_id", order.user_id)
    .eq("product_id", order.product_id)
    .order("access_end_at", { ascending: false });
  const subs: SubShape[] = (subsRaw || []) as SubShape[];
  const classification = classifyCandidates(subs);

  if (classification.decision === "multi_review") {
    const ids = classification.candidates.map((c) => c.id);
    await audit("grant.multi_candidate_review", {
      order_id: orderId,
      user_id: order.user_id,
      product_id: order.product_id,
      candidate_ids: ids,
    });
    return { kind: "manual_review_multi_candidate", candidate_ids: ids };
  }

  // 4) Load order tariff (for access_days/amount)
  let orderTariff: TariffShape | null = null;
  if (order.tariff_id) {
    const { data: t } = await supabase
      .from("tariffs")
      .select("id, access_days, amount")
      .eq("id", order.tariff_id)
      .maybeSingle();
    orderTariff = (t as TariffShape) || null;
  }

  // 5a) Create new subscription
  if (classification.decision === "create_new") {
    const trial = bootstrapTrial(order as OrderShape);
    const { extendFromDate, reason } = resolveExtendFromDate(null, order as OrderShape, now);
    let accessEndAt: Date;
    let status: string;
    let bootstrap: "trial" | "recurring";
    if (trial) {
      accessEndAt = new Date(trial.access_end_at);
      status = trial.status;
      bootstrap = "trial";
      await audit("grant.trial_bootstrap", {
        order_id: orderId,
        access_end_at: accessEndAt.toISOString(),
      });
    } else {
      const days = orderTariff?.access_days ?? 0;
      accessEndAt = new Date(extendFromDate.getTime() + days * DAY_MS);
      status = "active";
      bootstrap = "recurring";
    }

    const insertPayload = {
      user_id: order.user_id,
      product_id: order.product_id,
      tariff_id: order.tariff_id,
      order_id: orderId,
      status,
      access_start_at: now.toISOString(),
      access_end_at: accessEndAt.toISOString(),
      meta: {
        bootstrap,
        extend_from_reason: reason,
        created_by: "grant-access-for-order:3ds_finalize",
      },
    };
    const { data: inserted, error: insErr } = await supabase
      .from("subscriptions_v2")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insErr) return { kind: "error", reason: `insert_subscription: ${insErr.message}` };

    const next = computeNextChargeAt(accessEndAt, bootstrap === "trial");
    await audit("grant.next_charge_at_computed", {
      subscription_id: inserted.id,
      next_charge_at: next.next_charge_at,
      offset_days: next.offset_days,
      reason: next.reason,
    });

    return {
      kind: "bootstrap_created",
      subscription_id: inserted.id,
      access_end_at: accessEndAt.toISOString(),
      next_charge_at_suggested: next.next_charge_at,
      bootstrap,
    };
  }

  // 5b) Single candidate → extend / reattach / proration
  const sub = classification.candidates[0];
  const sameTariff =
    !!sub.tariff_id && !!order.tariff_id && sub.tariff_id === order.tariff_id;

  // Proration if tariff change on active sub
  let bonusDays = 0;
  let prorationMeta: Record<string, unknown> | undefined;
  if (sub.status === "active" && !sameTariff && sub.tariff_id && orderTariff) {
    const { data: oldT } = await supabase
      .from("tariffs")
      .select("id, access_days, amount")
      .eq("id", sub.tariff_id)
      .maybeSingle();
    if (oldT) {
      const p = applyProration(sub, oldT as TariffShape, orderTariff, now);
      bonusDays = p.bonus_days;
      prorationMeta = {
        old_tariff_id: sub.tariff_id,
        new_tariff_id: order.tariff_id,
        remaining_days: p.remaining_days,
        bonus_days: p.bonus_days,
      };
      await audit("grant.proration_applied", { order_id: orderId, ...prorationMeta });
    }
  }

  const { extendFromDate, reason } = resolveExtendFromDate(sub, order as OrderShape, now);
  const baseDays = orderTariff?.access_days ?? 0;
  const totalDays = baseDays + bonusDays;
  const newEnd = new Date(extendFromDate.getTime() + totalDays * DAY_MS);

  const updatePayload: Record<string, unknown> = {
    status: "active",
    order_id: orderId,
    access_end_at: newEnd.toISOString(),
    tariff_id: order.tariff_id ?? sub.tariff_id,
    meta: {
      ...(sub.meta ?? {}),
      extend_from_reason: reason,
      ...(prorationMeta ? { proration: prorationMeta } : {}),
      ...(sub.status === "past_due"
        ? { reattached_from_order_id: orderId, reattached_at: now.toISOString() }
        : {}),
      updated_by: "grant-access-for-order:3ds_finalize",
    },
  };

  const { error: updErr } = await supabase
    .from("subscriptions_v2")
    .update(updatePayload)
    .eq("id", sub.id);
  if (updErr) return { kind: "error", reason: `update_subscription: ${updErr.message}` };

  if (sub.status === "past_due") {
    await audit("grant.subscription_order_attached", {
      order_id: orderId,
      subscription_id: sub.id,
      prev_status: "past_due",
    });
  }

  const isTrial = !!order.is_trial;
  const next = computeNextChargeAt(newEnd, isTrial);
  await audit("grant.next_charge_at_computed", {
    subscription_id: sub.id,
    next_charge_at: next.next_charge_at,
    offset_days: next.offset_days,
    reason: next.reason,
  });

  const prevEnd = sub.access_end_at ? new Date(sub.access_end_at).getTime() : extendFromDate.getTime();
  const extendedByDays = Math.max(0, Math.round((newEnd.getTime() - prevEnd) / DAY_MS));

  return {
    kind: "extended",
    subscription_id: sub.id,
    access_end_at: newEnd.toISOString(),
    extended_by_days: extendedByDays,
    next_charge_at_suggested: next.next_charge_at,
    extend_from_reason: reason,
  };
}
