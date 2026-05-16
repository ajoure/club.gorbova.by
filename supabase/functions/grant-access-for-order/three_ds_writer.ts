// PATCH H2.1b-i (writer extension) + H2.1b-ii (race-INSERT guard + entitlement/telegram)
// Self-contained handler for `context: '3ds_finalize'` payloads to
// grant-access-for-order. Owns subscription decisions (multi-candidate guard,
// past_due reattach, proration, trial bootstrap), ensures primary entitlement
// (GREATEST), and invokes canonical telegram-grant-access. nextChargeAt is
// returned (NOT written) — provider-sync stays in bepaid-webhook.
//
// H2.1b-ii additions:
//   B.1: candidate search extended to (order_id, meta.bepaid_subscription_id).
//        >1 by sbs => manual_review_multi_candidate_sbs.
//   B.2: best-effort pre-INSERT re-check. NOT race-safe (no DB RPC/constraint).
//   skip_already_processed differentiates:
//        - subscription exists + entitlement valid           → skip_already_processed
//        - subscription exists, entitlement missing/expired  → reuse + ensure entitlement
//                                                            → outcome `incomplete_subscription_completed`
//        - subscription found, but data inconsistent         → manual_review_existing_subscription_incomplete

export type ThreeDsOutcome =
  | { kind: "ok"; subscription_id: string; access_end_at: string; next_charge_at_suggested: string | null }
  | {
      kind: "bootstrap_created";
      subscription_id: string;
      access_end_at: string;
      next_charge_at_suggested: string | null;
      bootstrap: "trial" | "recurring";
      entitlement_id?: string | null;
      telegram?: TelegramResult;
    }
  | {
      kind: "extended";
      subscription_id: string;
      access_end_at: string;
      extended_by_days: number;
      next_charge_at_suggested: string | null;
      extend_from_reason: ExtendFromReason;
      entitlement_id?: string | null;
      telegram?: TelegramResult;
    }
  | {
      kind: "incomplete_subscription_completed";
      subscription_id: string;
      access_end_at: string | null;
      next_charge_at_suggested: string | null;
      entitlement_id: string;
      telegram?: TelegramResult;
      reason: string;
    }
  | {
      kind: "skip_already_processed";
      subscription_id: string;
      access_end_at: string | null;
      next_charge_at_suggested: string | null;
      entitlement_id: string | null;
      reason?: string;
    }
  | { kind: "manual_review_multi_candidate"; candidate_ids: string[] }
  | { kind: "manual_review_multi_candidate_sbs"; candidate_ids: string[]; sbs: string }
  | {
      kind: "manual_review_existing_subscription_incomplete";
      subscription_id: string;
      reason: string;
    }
  | { kind: "skip_concurrent_insert"; reason: string }
  | { kind: "skip_no_order" | "skip_inactive_offer" | "skip_tariff_mismatch"; reason?: string }
  | { kind: "error"; reason: string };

export type ExtendFromReason =
  | "same_tariff_from_end"
  | "past_due_reattach_from_max"
  | "tariff_change_from_now"
  | "trial_from_trial_end"
  | "new_from_now";

export type TelegramResult =
  | { status: "skipped"; reason: string }
  | { status: "invoked"; club_id: string }
  | { status: "error"; reason: string };

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
  status: string;
  tariff_id: string | null;
  access_end_at: string | null;
  meta?: Record<string, unknown> | null;
  order_id?: string | null;
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

export function bootstrapTrial(order: OrderShape): { access_end_at: string; status: "trialing" } | null {
  if (!order.is_trial || !order.trial_end_at) return null;
  return { access_end_at: order.trial_end_at, status: "trialing" };
}

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

export function classifyCandidates(subs: SubShape[]): {
  decision: "create_new" | "single" | "multi_review";
  candidates: SubShape[];
} {
  const live = subs.filter((s) => ["active", "past_due", "trialing"].includes(s.status));
  if (live.length === 0) return { decision: "create_new", candidates: [] };
  if (live.length === 1) return { decision: "single", candidates: live };
  return { decision: "multi_review", candidates: live };
}

/**
 * H2.1b-ii B.1: classify by bepaid_subscription_id (sbs). Returns:
 *  - 'none'    — no candidate by sbs
 *  - 'single'  — exactly 1 → caller can reuse
 *  - 'multi'   — >1 → manual_review_multi_candidate_sbs
 */
export function classifyBySbs(subs: SubShape[], sbs: string | null): {
  decision: "none" | "single" | "multi";
  candidates: SubShape[];
} {
  if (!sbs) return { decision: "none", candidates: [] };
  const matched = subs.filter((s) => {
    const subSbs = ((s.meta || {}) as any).bepaid_subscription_id;
    return subSbs && String(subSbs) === String(sbs);
  });
  if (matched.length === 0) return { decision: "none", candidates: [] };
  if (matched.length === 1) return { decision: "single", candidates: matched };
  return { decision: "multi", candidates: matched };
}

// ============================================================
// Handler
// ============================================================

type Sb = { from: (t: string) => any; functions?: { invoke: (name: string, opts: any) => Promise<any> } };

export interface ThreeDsHandlerDeps {
  supabase: Sb;
  now?: Date;
  audit?: (action: string, meta: Record<string, unknown>) => Promise<void>;
  invokeTelegramGrant?: (args: TelegramGrantArgs) => Promise<TelegramResult>;
}

export interface TelegramGrantArgs {
  user_id: string;
  club_id: string;
  source_id: string;
  duration_days?: number | null;
}

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

  const orderSbs: string | null = (order.meta as any)?.bepaid_subscription_id ?? null;

  // 2) Candidate scan: (user_id, product_id) ALL non-canceled.
  const { data: subsRaw } = await supabase
    .from("subscriptions_v2")
    .select("id, status, tariff_id, access_end_at, meta, order_id")
    .eq("user_id", order.user_id)
    .eq("product_id", order.product_id)
    .order("access_end_at", { ascending: false, nullsFirst: false });
  const subs: SubShape[] = (subsRaw || []) as SubShape[];

  // 2a) B.1: sbs-multi guard FIRST (highest signal).
  if (orderSbs) {
    const sbsClass = classifyBySbs(subs, orderSbs);
    if (sbsClass.decision === "multi") {
      const ids = sbsClass.candidates.map((c) => c.id);
      await audit("grant.multi_candidate_review_sbs", {
        order_id: orderId,
        user_id: order.user_id,
        product_id: order.product_id,
        sbs: orderSbs,
        candidate_ids: ids,
      });
      return { kind: "manual_review_multi_candidate_sbs", candidate_ids: ids, sbs: orderSbs };
    }
  }

  // 2b) B.1: candidate by order_id (this same order already linked to a sub).
  const byOrderId = subs.find((s) => s.order_id === orderId) || null;
  // 2c) B.1: candidate by sbs (single).
  const bySbs = orderSbs ? subs.find((s) => ((s.meta || {}) as any).bepaid_subscription_id === orderSbs) || null : null;

  const reusedSub = byOrderId || bySbs;

  // 3) If we have a sub by order_id or sbs → reuse path, check entitlement state.
  if (reusedSub) {
    const entitlementState = await loadPrimaryEntitlement(supabase, order.user_id, order.product_id);
    const entitlementValid = entitlementState?.expires_at
      ? new Date(entitlementState.expires_at).getTime() > now.getTime()
      : false;

    if (entitlementState && entitlementValid) {
      // Truly already processed.
      return {
        kind: "skip_already_processed",
        subscription_id: reusedSub.id,
        access_end_at: reusedSub.access_end_at,
        next_charge_at_suggested: reusedSub.access_end_at
          ? computeNextChargeAt(new Date(reusedSub.access_end_at), !!order.is_trial).next_charge_at
          : null,
        entitlement_id: entitlementState.id,
        reason: byOrderId ? "subscription_and_entitlement_present_by_order_id" : "subscription_and_entitlement_present_by_sbs",
      };
    }

    // Sub exists but entitlement missing/expired → ensure entitlement.
    if (!reusedSub.access_end_at) {
      await audit("grant.existing_subscription_incomplete", {
        order_id: orderId,
        subscription_id: reusedSub.id,
        reason: "subscription_has_no_access_end_at",
      });
      return {
        kind: "manual_review_existing_subscription_incomplete",
        subscription_id: reusedSub.id,
        reason: "subscription_has_no_access_end_at",
      };
    }

    // Ensure primary entitlement aligned to subscription.access_end_at (GREATEST).
    const ensured = await ensurePrimaryEntitlement(
      supabase,
      {
        userId: order.user_id,
        productId: order.product_id,
        orderId,
        targetExpiresAt: new Date(reusedSub.access_end_at),
        audit,
        existing: entitlementState,
      },
    );
    if (ensured.kind === "error") {
      return { kind: "error", reason: `ensure_entitlement: ${ensured.reason}` };
    }

    const telegram = await invokeTelegram(supabase, {
      userId: order.user_id,
      productId: order.product_id,
      orderId,
      deps,
      audit,
    });

    await audit("grant.incomplete_subscription_completed", {
      order_id: orderId,
      subscription_id: reusedSub.id,
      entitlement_id: ensured.entitlement_id,
      access_end_at: reusedSub.access_end_at,
      matched_via: byOrderId ? "order_id" : "sbs",
    });

    return {
      kind: "incomplete_subscription_completed",
      subscription_id: reusedSub.id,
      access_end_at: reusedSub.access_end_at,
      next_charge_at_suggested: computeNextChargeAt(new Date(reusedSub.access_end_at), !!order.is_trial).next_charge_at,
      entitlement_id: ensured.entitlement_id,
      telegram,
      reason: byOrderId ? "matched_by_order_id_missing_entitlement" : "matched_by_sbs_missing_entitlement",
    };
  }

  // 4) Classic multi-candidate guard on remaining live subs.
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

  // 5) Load order tariff
  let orderTariff: TariffShape | null = null;
  if (order.tariff_id) {
    const { data: t } = await supabase
      .from("tariffs")
      .select("id, access_days, amount")
      .eq("id", order.tariff_id)
      .maybeSingle();
    orderTariff = (t as TariffShape) || null;
  }

  // 6a) CREATE NEW (with best-effort pre-INSERT re-check).
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
      await audit("grant.trial_bootstrap", { order_id: orderId, access_end_at: accessEndAt.toISOString() });
    } else {
      const days = orderTariff?.access_days ?? 0;
      accessEndAt = new Date(extendFromDate.getTime() + days * DAY_MS);
      status = "active";
      bootstrap = "recurring";
    }

    // B.2: best-effort pre-INSERT re-check (NOT race-safe — no DB-level lock).
    const { data: reChk } = await supabase
      .from("subscriptions_v2")
      .select("id, status, order_id, meta")
      .eq("user_id", order.user_id)
      .eq("product_id", order.product_id)
      .in("status", ["active", "past_due", "trialing"]);
    const reChkSubs: SubShape[] = (reChk || []) as SubShape[];
    if (reChkSubs.length > 0) {
      await audit("grant.race_insert_avoided", {
        order_id: orderId,
        user_id: order.user_id,
        product_id: order.product_id,
        appeared_candidate_ids: reChkSubs.map((s) => s.id),
      });
      return {
        kind: "skip_concurrent_insert",
        reason: `pre_insert_recheck_found_${reChkSubs.length}_candidates`,
      };
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
        ...(orderSbs ? { bepaid_subscription_id: orderSbs } : {}),
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

    // Ensure entitlement + telegram for the freshly created sub.
    const existingEnt = await loadPrimaryEntitlement(supabase, order.user_id, order.product_id);
    const ensured = await ensurePrimaryEntitlement(supabase, {
      userId: order.user_id,
      productId: order.product_id,
      orderId,
      targetExpiresAt: accessEndAt,
      audit,
      existing: existingEnt,
    });
    if (ensured.kind === "error") {
      // Subscription was created but entitlement failed — surface as error.
      return { kind: "error", reason: `ensure_entitlement_after_create: ${ensured.reason}` };
    }
    const telegram = await invokeTelegram(supabase, {
      userId: order.user_id,
      productId: order.product_id,
      orderId,
      deps,
      audit,
    });

    return {
      kind: "bootstrap_created",
      subscription_id: inserted.id,
      access_end_at: accessEndAt.toISOString(),
      next_charge_at_suggested: next.next_charge_at,
      bootstrap,
      entitlement_id: ensured.entitlement_id,
      telegram,
    };
  }

  // 6b) SINGLE candidate → extend / reattach / proration
  const sub = classification.candidates[0];
  const prevStatus = sub.status;
  const sameTariff = !!sub.tariff_id && !!order.tariff_id && sub.tariff_id === order.tariff_id;

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
      ...(prevStatus === "past_due"
        ? { reattached_from_order_id: orderId, reattached_at: now.toISOString() }
        : {}),
      ...(orderSbs ? { bepaid_subscription_id: orderSbs } : {}),
      updated_by: "grant-access-for-order:3ds_finalize",
    },
  };

  const { error: updErr } = await supabase
    .from("subscriptions_v2")
    .update(updatePayload)
    .eq("id", sub.id);
  if (updErr) return { kind: "error", reason: `update_subscription: ${updErr.message}` };

  if (prevStatus === "past_due") {
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

  // Ensure entitlement aligned to newEnd; telegram grant.
  const existingEnt = await loadPrimaryEntitlement(supabase, order.user_id, order.product_id);
  const ensured = await ensurePrimaryEntitlement(supabase, {
    userId: order.user_id,
    productId: order.product_id,
    orderId,
    targetExpiresAt: newEnd,
    audit,
    existing: existingEnt,
  });
  if (ensured.kind === "error") {
    return { kind: "error", reason: `ensure_entitlement_after_extend: ${ensured.reason}` };
  }
  const telegram = await invokeTelegram(supabase, {
    userId: order.user_id,
    productId: order.product_id,
    orderId,
    deps,
    audit,
  });

  return {
    kind: "extended",
    subscription_id: sub.id,
    access_end_at: newEnd.toISOString(),
    extended_by_days: extendedByDays,
    next_charge_at_suggested: next.next_charge_at,
    extend_from_reason: reason,
    entitlement_id: ensured.entitlement_id,
    telegram,
  };
}

// ============================================================
// Entitlement helpers (canonical, GREATEST semantics)
// ============================================================

interface EntRow {
  id: string;
  expires_at: string | null;
  product_code: string | null;
  product_id: string | null;
  status: string | null;
  meta: Record<string, unknown> | null;
}

async function loadPrimaryEntitlement(
  supabase: Sb,
  userId: string,
  productId: string,
): Promise<EntRow | null> {
  const { data } = await supabase
    .from("entitlements")
    .select("id, expires_at, product_code, product_id, status, meta")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();
  return (data as EntRow | null) || null;
}

type EnsureResult =
  | { kind: "noop"; entitlement_id: string }
  | { kind: "updated"; entitlement_id: string }
  | { kind: "created"; entitlement_id: string }
  | { kind: "error"; reason: string };

async function ensurePrimaryEntitlement(
  supabase: Sb,
  args: {
    userId: string;
    productId: string;
    orderId: string;
    targetExpiresAt: Date;
    audit: (action: string, meta: Record<string, unknown>) => Promise<void>;
    existing: EntRow | null;
  },
): Promise<EnsureResult> {
  const { userId, productId, orderId, targetExpiresAt, audit, existing } = args;

  if (existing) {
    const cur = existing.expires_at ? new Date(existing.expires_at) : new Date(0);
    const finalExpires = cur > targetExpiresAt ? cur : targetExpiresAt;
    const needsUpdate =
      finalExpires.getTime() !== cur.getTime() ||
      existing.status !== "active";
    if (!needsUpdate) {
      return { kind: "noop", entitlement_id: existing.id };
    }
    const { error: updErr } = await supabase
      .from("entitlements")
      .update({
        expires_at: finalExpires.toISOString(),
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updErr) return { kind: "error", reason: `entitlement_update: ${updErr.message}` };
    await audit("grant.entitlement_updated_greatest", {
      order_id: orderId,
      entitlement_id: existing.id,
      previous_expires_at: existing.expires_at,
      new_expires_at: finalExpires.toISOString(),
    });
    return { kind: "updated", entitlement_id: existing.id };
  }

  // Resolve profile_id + product_code for new row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) {
    return { kind: "error", reason: "ghost_user_no_profile" };
  }
  const { data: prod } = await supabase
    .from("products_v2")
    .select("id, code, name")
    .eq("id", productId)
    .maybeSingle();
  const productCode = (prod as any)?.code || `product_${productId}`;

  const { data: inserted, error: insErr } = await supabase
    .from("entitlements")
    .insert({
      user_id: userId,
      profile_id: profile.id,
      order_id: orderId,
      product_code: productCode,
      product_id: productId,
      status: "active",
      expires_at: targetExpiresAt.toISOString(),
      meta: {
        source: "grant-access-for-order:3ds_finalize",
        granted_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();
  if (insErr) return { kind: "error", reason: `entitlement_insert: ${insErr.message}` };
  await audit("grant.entitlement_created", {
    order_id: orderId,
    entitlement_id: inserted.id,
    product_id: productId,
    expires_at: targetExpiresAt.toISOString(),
  });
  return { kind: "created", entitlement_id: inserted.id };
}

// ============================================================
// Telegram canonical grant helper
// ============================================================

async function invokeTelegram(
  supabase: Sb,
  args: {
    userId: string;
    productId: string;
    orderId: string;
    deps: ThreeDsHandlerDeps;
    audit: (action: string, meta: Record<string, unknown>) => Promise<void>;
  },
): Promise<TelegramResult> {
  const { userId, productId, orderId, deps, audit } = args;

  const { data: product } = await supabase
    .from("products_v2")
    .select("id, telegram_club_id")
    .eq("id", productId)
    .maybeSingle();
  const clubId: string | null = (product as any)?.telegram_club_id ?? null;
  if (!clubId) {
    await audit("grant.telegram_skipped_no_club", { order_id: orderId, product_id: productId });
    return { status: "skipped", reason: "no_club_configured" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("telegram_user_id, telegram_link_status")
    .eq("user_id", userId)
    .maybeSingle();
  const linked = !!(profile as any)?.telegram_user_id && (profile as any)?.telegram_link_status === "active";
  if (!linked) {
    await audit("grant.telegram_skipped_not_linked", { order_id: orderId, user_id: userId });
    return { status: "skipped", reason: "telegram_not_linked" };
  }

  // Allow dep injection for tests.
  if (deps.invokeTelegramGrant) {
    try {
      const r = await deps.invokeTelegramGrant({
        user_id: userId,
        club_id: clubId,
        source_id: orderId,
      });
      return r;
    } catch (e) {
      return { status: "error", reason: String((e as Error)?.message || e) };
    }
  }

  if (!supabase.functions) {
    return { status: "skipped", reason: "no_functions_client" };
  }
  try {
    const res = await supabase.functions.invoke("telegram-grant-access", {
      body: {
        user_id: userId,
        club_id: clubId,
        source_id: orderId,
        source: "grant-access-for-order:3ds_finalize",
      },
    });
    if ((res as any)?.error) {
      return { status: "error", reason: String((res as any).error?.message || (res as any).error) };
    }
    return { status: "invoked", club_id: clubId };
  } catch (e) {
    return { status: "error", reason: String((e as Error)?.message || e) };
  }
}
