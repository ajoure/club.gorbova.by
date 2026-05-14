import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildSbsMismatchAuditPayload,
  buildSbsMismatchOrderMetaMerge,
  buildSbsMismatchResponseBody,
  resolvePaymentFlow,
  decideSbsMismatchAction,
} from "./sbs_mismatch_guard.ts";
import { isCalendarMonthProduct, calcCalendarMonthEnd } from '../_shared/resolve-access-window.ts';
import { writeLedgerEntry, buildPostCheck } from '../_shared/fulfillment-executor.ts';
import { checkPriorPurchase } from '../_shared/check-prior-purchase.ts';
import {
  resolveProductAccessRules,
  syncSecondaryProductAccessForUser,
} from '../_shared/product-access-grants.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// PATCH: Staff emails - NEVER modify subscriptions for these users
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

/**
 * SOT-aligned recurring resolver. Read-only helper. NEVER mutates orders_v2.offer_id.
 *
 * Decision matrix:
 *   1) order.offer_id present AND its tariff_offers.meta.recurring.is_recurring = true
 *      → decision = 'from_order_offer', is_recurring = true
 *   2) order.offer_id missing/non-recurring, but tariff has an active recurring offer
 *      → decision = 'resolved_from_tariff', is_recurring = true
 *   3) Neither → decision = 'one_time' or 'not_resolved', is_recurring = false
 *
 * snapshot_complete distinguishes a real data-defect (recurring offer present
 * but meta.recurring incomplete) from the normal "no recurring at all" case.
 */
async function resolveRecurringFromOrderOrTariff(
  supabase: any,
  orderOfferId: string | null | undefined,
  tariffId: string | null | undefined,
): Promise<{
  is_recurring: boolean;
  snapshot: Record<string, any> | null;
  snapshot_complete: boolean;
  resolved_offer_id: string | null;
  decision: 'from_order_offer' | 'resolved_from_tariff' | 'one_time' | 'not_resolved';
}> {
  const REQUIRED_KEYS = [
    'is_recurring',
    'billing_period_mode',
    'grace_hours',
    'charge_attempts_per_day',
    'charge_times_local',
  ];
  const isComplete = (snap: any): boolean => {
    if (!snap || typeof snap !== 'object') return false;
    return REQUIRED_KEYS.every((k) => snap[k] !== undefined && snap[k] !== null);
  };

  // 1) Try order.offer_id directly
  if (orderOfferId) {
    const { data: offerRow } = await supabase
      .from('tariff_offers')
      .select('id, tariff_id, meta')
      .eq('id', orderOfferId)
      .maybeSingle();

    const recurring = offerRow?.meta?.recurring || null;
    if (recurring?.is_recurring === true) {
      return {
        is_recurring: true,
        snapshot: recurring,
        snapshot_complete: isComplete(recurring),
        resolved_offer_id: offerRow.id,
        decision: 'from_order_offer',
      };
    }
    // Order's offer is non-recurring — fall through to tariff probe.
  }

  // 2) Probe tariff for an active recurring offer
  if (tariffId) {
    const { data: tariffOffers } = await supabase
      .from('tariff_offers')
      .select('id, is_active, is_primary, sort_order, meta')
      .eq('tariff_id', tariffId)
      .eq('is_active', true);

    const recurringOffers = (tariffOffers || []).filter(
      (o: any) => o?.meta?.recurring?.is_recurring === true,
    );

    if (recurringOffers.length > 0) {
      recurringOffers.sort((a: any, b: any) => {
        if ((b.is_primary ? 1 : 0) !== (a.is_primary ? 1 : 0)) {
          return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0);
        }
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
      const chosen = recurringOffers[0];
      const snap = chosen.meta?.recurring || null;
      return {
        is_recurring: true,
        snapshot: snap,
        snapshot_complete: isComplete(snap),
        resolved_offer_id: chosen.id,
        decision: 'resolved_from_tariff',
      };
    }

    // Tariff has no active recurring offer → SOT says one-time
    return {
      is_recurring: false,
      snapshot: null,
      snapshot_complete: false,
      resolved_offer_id: null,
      decision: 'one_time',
    };
  }

  // 3) No offer_id, no tariff_id → cannot decide
  return {
    is_recurring: false,
    snapshot: null,
    snapshot_complete: false,
    resolved_offer_id: null,
    decision: 'not_resolved',
  };
}

/**
 * PATCH 2: Get correct recurring_amount for trial orders
 * For trial orders, we need the price from auto_charge_offer_id, not order.final_price (1 BYN)
 * 
 * The offer_id can be stored in:
 * - order.offer_id (top-level field)
 * - order.meta.offer_id (meta object)
 * - order.meta.auto_charge_offer_id (direct reference to full payment offer)
 */
async function getRecurringAmount(order: any, supabase: any): Promise<number> {
  // Default: use order's final_price
  let recurringAmount = order.final_price;
  const orderMeta = (order.meta || {}) as Record<string, any>;

  // For trial orders, look up the real price from auto_charge_offer
  if (!order.is_trial) {
    return recurringAmount;
  }

  try {
    // First check if auto_charge_offer_id is already in meta
    if (orderMeta.auto_charge_offer_id) {
      const { data: fullOffer } = await supabase
        .from('tariff_offers')
        .select('amount')
        .eq('id', orderMeta.auto_charge_offer_id)
        .maybeSingle();

      if (fullOffer?.amount) {
        recurringAmount = fullOffer.amount;
        console.log(`[grant-access] Trial order: recurring_amount from meta.auto_charge_offer_id = ${recurringAmount} (was ${order.final_price})`);
        return recurringAmount;
      }
    }

    // Fallback: try to find offer_id (can be in order.offer_id or order.meta.offer_id)
    const offerId = order.offer_id || orderMeta.offer_id;
    if (offerId) {
      const { data: trialOffer } = await supabase
        .from('tariff_offers')
        .select('auto_charge_offer_id')
        .eq('id', offerId)
        .maybeSingle();

      if (trialOffer?.auto_charge_offer_id) {
        const { data: fullOffer } = await supabase
          .from('tariff_offers')
          .select('amount')
          .eq('id', trialOffer.auto_charge_offer_id)
          .maybeSingle();

        if (fullOffer?.amount) {
          recurringAmount = fullOffer.amount;
          console.log(`[grant-access] Trial order: recurring_amount from offer.auto_charge_offer_id = ${recurringAmount} (was ${order.final_price})`);
          return recurringAmount;
        }
      }
    }

    // Last fallback: use auto_charge_amount from meta if available
    if (orderMeta.auto_charge_amount && orderMeta.auto_charge_amount > 0) {
      recurringAmount = orderMeta.auto_charge_amount;
      console.log(`[grant-access] Trial order: recurring_amount from meta.auto_charge_amount = ${recurringAmount} (was ${order.final_price})`);
      return recurringAmount;
    }

    console.warn(`[grant-access] Trial order ${order.id}: no auto_charge_offer found, using final_price ${order.final_price}`);
  } catch (err) {
    console.error('[grant-access] Error fetching auto_charge_offer amount:', err);
  }

  return recurringAmount;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      orderId, 
      customAccessDays,
      customAccessStartAt,  // NEW: optional custom start date
      customAccessEndAt,    // PATCH: exact target end date (priority over days)
      extendFromCurrent = true,
      grantTelegram = true,
      grantGetcourse = true,
      adminManualAccessEdit = false,
      manualSubscriptionId = null,
    } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "orderId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load order with product/tariff info
    const { data: order, error: orderError } = await supabase
      .from("orders_v2")
      .select(`
        *,
        product:products_v2(id, name, code),
        tariff:tariffs(id, name, access_days)
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found", details: orderError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user_id exists
    if (!order.user_id) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          warning: "no_user_id",
          message: "Заказ без user_id. Доступ будет выдан после регистрации пользователя."
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = order.user_id;
    const profileId = order.profile_id;
    const productId = order.product_id;

    // Admin manual access edit: exact date correction path.
    // This is intentionally before the idempotency replay guard, because editing an
    // already fulfilled order must not become a no-op. It updates only the primary
    // access window for the order's user/product and writes a server-side audit.
    if (adminManualAccessEdit === true) {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      const actor = authData?.user || null;
      if (authError || !actor) {
        return new Response(
          JSON.stringify({ success: false, error: "admin_manual_access_edit_unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
        supabase.rpc("has_role_v2", { _user_id: actor.id, _role_code: "admin" }),
        supabase.rpc("has_role_v2", { _user_id: actor.id, _role_code: "super_admin" }),
      ]);
      if (!isAdmin && !isSuperAdmin) {
        return new Response(
          JSON.stringify({ success: false, error: "admin_manual_access_edit_forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!customAccessEndAt) {
        return new Response(
          JSON.stringify({ success: false, error: "customAccessEndAt is required for admin manual access edit" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const manualAccessEndAt = new Date(customAccessEndAt);
      if (Number.isNaN(manualAccessEndAt.getTime())) {
        return new Response(
          JSON.stringify({ success: false, error: "customAccessEndAt is invalid" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let subQuery = supabase
        .from("subscriptions_v2")
        .select("id, access_end_at, next_charge_at, status, tariff_id, meta")
        .eq("user_id", userId)
        .eq("product_id", productId);
      if (manualSubscriptionId) subQuery = subQuery.eq("id", manualSubscriptionId);
      const { data: candidateSubs, error: subLookupError } = await subQuery
        .order("access_end_at", { ascending: false, nullsFirst: false })
        .limit(5);

      if (subLookupError) {
        return new Response(
          JSON.stringify({ success: false, error: "admin_manual_access_edit_subscription_lookup_failed", details: subLookupError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const subscriptionToEdit = (candidateSubs || []).find((s: any) => s.tariff_id === order.tariff_id) || candidateSubs?.[0] || null;
      const { data: existingEntitlement } = await supabase
        .from("entitlements")
        .select("id, expires_at, meta")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .maybeSingle();

      const before = {
        subscription_id: subscriptionToEdit?.id || null,
        subscription_access_end_at: subscriptionToEdit?.access_end_at || null,
        subscription_next_charge_at: subscriptionToEdit?.next_charge_at || null,
        entitlement_id: existingEntitlement?.id || null,
        entitlement_expires_at: existingEntitlement?.expires_at || null,
      };

      const nowIso = new Date().toISOString();
      let updatedSubscriptionId: string | null = null;
      let updatedEntitlementId: string | null = null;

      if (subscriptionToEdit?.id) {
        const existingMeta = (subscriptionToEdit.meta || {}) as Record<string, unknown>;
        const { error: updateSubError } = await supabase
          .from("subscriptions_v2")
          .update({
            status: "active",
            access_end_at: manualAccessEndAt.toISOString(),
            next_charge_at: manualAccessEndAt.toISOString(),
            updated_at: nowIso,
            meta: {
              ...existingMeta,
              manual_access_edit_last_at: nowIso,
              manual_access_edit_last_by: actor.id,
              manual_access_edit_last_order_id: orderId,
              manual_access_edit_previous_end_at: subscriptionToEdit.access_end_at || null,
            },
          })
          .eq("id", subscriptionToEdit.id);
        if (updateSubError) {
          return new Response(
            JSON.stringify({ success: false, error: "admin_manual_access_edit_subscription_update_failed", details: updateSubError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updatedSubscriptionId = subscriptionToEdit.id;
      }

      if (existingEntitlement?.id) {
        const existingMeta = (existingEntitlement.meta || {}) as Record<string, unknown>;
        const { error: updateEntError } = await supabase
          .from("entitlements")
          .update({
            status: "active",
            expires_at: manualAccessEndAt.toISOString(),
            updated_at: nowIso,
            meta: {
              ...existingMeta,
              manual_access_edit_last_at: nowIso,
              manual_access_edit_last_by: actor.id,
              manual_access_edit_last_order_id: orderId,
              manual_access_edit_previous_expires_at: existingEntitlement.expires_at || null,
            },
          })
          .eq("id", existingEntitlement.id);
        if (updateEntError) {
          return new Response(
            JSON.stringify({ success: false, error: "admin_manual_access_edit_entitlement_update_failed", details: updateEntError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updatedEntitlementId = existingEntitlement.id;
      }

      if (!updatedSubscriptionId && !updatedEntitlementId) {
        return new Response(
          JSON.stringify({ success: false, error: "admin_manual_access_edit_no_access_record_found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("audit_logs").insert({
        action: "admin.manual_access_date_edit",
        actor_type: "admin",
        actor_user_id: actor.id,
        actor_label: actor.email || "admin",
        target_user_id: userId,
        meta: {
          order_id: orderId,
          product_id: productId,
          tariff_id: order.tariff_id,
          requested_subscription_id: manualSubscriptionId,
          before,
          after: {
            subscription_id: updatedSubscriptionId,
            entitlement_id: updatedEntitlementId,
            access_end_at: manualAccessEndAt.toISOString(),
          },
          decreased_access_window:
            !!(before.subscription_access_end_at && manualAccessEndAt < new Date(before.subscription_access_end_at)) ||
            !!(before.entitlement_expires_at && manualAccessEndAt < new Date(before.entitlement_expires_at)),
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          manual_access_edit: true,
          results: {
            orderId,
            userId,
            productId,
            subscription: updatedSubscriptionId ? { action: "manual_date_updated", id: updatedSubscriptionId } : null,
            entitlement: updatedEntitlementId ? { action: "manual_date_updated", id: updatedEntitlementId } : null,
            accessEndAt: manualAccessEndAt.toISOString(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── IDEMPOTENCY HARD GUARD ──────────────────────────────────────────
    // If this order already fulfilled (both entitlement AND subscription exist
    // for the CORRECT product_id), return strict no-op.
    // Covers both "created by" (order_id column) and "extended by" (meta.extended_by_orders).
    const { data: existingEntByOrder } = await supabase
      .from("entitlements")
      .select("id, status, expires_at, product_id")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    const { data: existingSubByOrder } = await supabase
      .from("subscriptions_v2")
      .select("id, status, access_end_at, product_id")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    // Also check if any subscription for this user+product was EXTENDED by this orderId
    let existingSubExtendedByOrder: { id: string; status: string; access_end_at: string | null; product_id: string } | null = null;
    if (!existingSubByOrder && productId) {
      const { data: extendedSubs } = await supabase
        .from("subscriptions_v2")
        .select("id, status, access_end_at, product_id, meta")
        .eq("user_id", userId)
        .eq("product_id", productId);

      if (extendedSubs) {
        for (const sub of extendedSubs) {
          const meta = sub.meta as any;
          const extendedBy: string[] = meta?.extended_by_orders || [];
          if (extendedBy.includes(orderId)) {
            existingSubExtendedByOrder = sub;
            break;
          }
        }
      }
    }

    // Only consider fulfilled if entitlement matches the order's product_id
    const entitlementMatchesProduct = existingEntByOrder && existingEntByOrder.product_id === productId;
    const subscriptionMatchesOrder = existingSubByOrder && existingSubByOrder.product_id === productId;
    const subscriptionExtendedByOrder = !!existingSubExtendedByOrder;

    const resolvedSubscription = existingSubByOrder || existingSubExtendedByOrder;

    // PATCH 12.2 (skip-stale guard):
    // Before treating order as already fulfilled, verify that the existing
    // entitlement/subscription dates actually reach `expected_min_end`. If
    // either side is stale (more than 12h short of expected), do NOT skip —
    // fall through to the normal extend-flow so GREATEST can recover the date.
    const tariffForSkipGuard = (order as any).tariff as { access_days?: number } | null;
    const accessDaysForSkipGuard = customAccessDays ?? tariffForSkipGuard?.access_days ?? 30;
    const paidAtForSkipGuard = (order as any).paid_at
      ? new Date((order as any).paid_at)
      : new Date();
    const expectedMinEndForSkipGuard = new Date(
      paidAtForSkipGuard.getTime() + accessDaysForSkipGuard * 24 * 60 * 60 * 1000
    );
    const skipGuardThresholdMs = expectedMinEndForSkipGuard.getTime() - 12 * 60 * 60 * 1000;

    const entitlementDateOk = !!(
      existingEntByOrder?.expires_at &&
      new Date(existingEntByOrder.expires_at).getTime() >= skipGuardThresholdMs
    );
    const subscriptionDateOk = !!(
      resolvedSubscription?.access_end_at &&
      new Date(resolvedSubscription.access_end_at).getTime() >= skipGuardThresholdMs
    );

    const datesAreStale = (entitlementMatchesProduct && !entitlementDateOk)
      || ((subscriptionMatchesOrder || subscriptionExtendedByOrder) && !subscriptionDateOk);

    if (entitlementMatchesProduct && (subscriptionMatchesOrder || subscriptionExtendedByOrder) && datesAreStale) {
      // PATCH 12.2: do NOT skip — write audit and fall through to extend-flow.
      await supabase.from("audit_logs").insert({
        action: "grant-access-for-order.skip_blocked_stale_access",
        actor_type: "system",
        actor_user_id: null,
        actor_label: "grant-access-for-order",
        target_user_id: userId,
        meta: {
          order_id: orderId,
          product_id: productId,
          paid_at: paidAtForSkipGuard.toISOString(),
          expected_min_end: expectedMinEndForSkipGuard.toISOString(),
          access_days: accessDaysForSkipGuard,
          existing_entitlement_id: existingEntByOrder?.id || null,
          existing_entitlement_expires_at: existingEntByOrder?.expires_at || null,
          existing_subscription_id: resolvedSubscription?.id || null,
          existing_subscription_access_end_at: resolvedSubscription?.access_end_at || null,
          subscription_status: resolvedSubscription?.status || null,
          entitlement_status: existingEntByOrder?.status || null,
          entitlement_date_ok: entitlementDateOk,
          subscription_date_ok: subscriptionDateOk,
          patch: "patch-12.2-skip-stale-guard",
        },
      });
      console.log(`[grant-access] PATCH 12.2: skip_already_fulfilled BLOCKED for order ${orderId} — existing dates stale vs expected_min_end=${expectedMinEndForSkipGuard.toISOString()}. Falling through to extend-flow.`);
      // intentional fall-through: do NOT return, continue to normal flow below.
    } else if (entitlementMatchesProduct && (subscriptionMatchesOrder || subscriptionExtendedByOrder)) {
      const guardSource = subscriptionMatchesOrder ? "order_id" : "extended_by_orders";
      console.log(`[grant-access] IDEMPOTENCY GUARD: order ${orderId} already fulfilled (product ${productId}, match via ${guardSource}). Running secondary product_access sync to ensure bonus grants are present.`);

      // Even if primary access already exists, secondary product_access bonuses
      // could have been missed previously (race / partial failure / rule update).
      // Run idempotent secondary sync via shared helper before returning.
      let secondaryActions: any[] = [];
      try {
        const rules = await resolveProductAccessRules(
          supabase,
          productId,
          order.tariff_id || null,
        );
        if (rules.length > 0) {
          secondaryActions = await syncSecondaryProductAccessForUser(supabase, {
            userId,
            profileId: order.profile_id || null,
            sourceProductId: productId,
            sourceTariffId: order.tariff_id || null,
            sourceSubscription: resolvedSubscription
              ? { id: resolvedSubscription.id, access_end_at: resolvedSubscription.access_end_at }
              : null,
            rules,
            excludeOrderId: orderId,
            ctx: {
              sourceEventType: 'webhook',
              sourceSubjectType: 'order',
              sourceEventKeyPrefix: `gafo:idempotent_resync:${orderId}`,
              orderId,
            },
          });
        }
      } catch (e) {
        console.error('[grant-access] secondary sync on idempotent path failed (non-critical):', e);
      }

      await supabase.from("audit_logs").insert({
        action: "grant-access-for-order.skip_already_fulfilled",
        actor_type: "system",
        actor_user_id: null,
        actor_label: "grant-access-for-order",
        target_user_id: userId,
        meta: {
          order_id: orderId,
          product_id: productId,
          existing_entitlement_id: existingEntByOrder.id,
          existing_subscription_id: resolvedSubscription!.id,
          entitlement_status: existingEntByOrder.status,
          entitlement_expires_at: existingEntByOrder.expires_at,
          subscription_status: resolvedSubscription!.status,
          subscription_access_end_at: resolvedSubscription!.access_end_at,
          guard_match_source: guardSource,
          secondary_sync_count: secondaryActions.length,
          secondary_sync_outcomes: secondaryActions.reduce((acc: any, a: any) => {
            acc[a.outcome] = (acc[a.outcome] || 0) + 1;
            return acc;
          }, {}),
          // PATCH 12.2 telemetry: confirms skip was allowed (dates fresh).
          skip_guard_passed: true,
          expected_min_end: expectedMinEndForSkipGuard.toISOString(),
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          already_fulfilled: true,
          // PATCH rebill-idempotency-fix-2026-05: lift IDs to top level so callers
          // (bepaid-webhook rebill path) can extend access without depending on `existing` shape.
          subscription_id: resolvedSubscription!.id,
          subscription_v2_id: resolvedSubscription!.id,
          entitlement_id: existingEntByOrder.id,
          message: "Доступ по этому заказу уже был выдан ранее",
          existing: {
            entitlement_id: existingEntByOrder.id,
            subscription_id: resolvedSubscription!.id,
            guard_match_source: guardSource,
          },
          product_access: secondaryActions,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log if entitlement exists for wrong product (collision case from split)
    if (existingEntByOrder && !entitlementMatchesProduct) {
      console.warn(`[grant-access] IDEMPOTENCY GUARD: order ${orderId} has entitlement ${existingEntByOrder.id} but for WRONG product ${existingEntByOrder.product_id} (expected ${productId}). Proceeding to collision handling.`);
    }
    // ── END IDEMPOTENCY GUARD ───────────────────────────────────────────
    const tariffId = order.tariff_id;
    const product = order.product as any;
    const tariff = order.tariff as any;
    
    const productCode = product?.code || (order.purchase_snapshot as any)?.product_code || "general";
    
    // Calculate access period - use custom days if provided, otherwise from tariff
    // Phase 1: calendar month rule from products_v2.meta instead of hardcoded UUID
    const now = new Date();
    const isClubProduct = await isCalendarMonthProduct(supabase, productId);
    const durationDays = customAccessDays ?? tariff?.access_days ?? 30;
    
    // Determine base start date:
    // 1. If customAccessStartAt provided — use it
    // 2. Otherwise use order.created_at (deal date)
    // 3. Fallback to now if nothing available
    let baseStartDate = now;
    if (customAccessStartAt) {
      baseStartDate = new Date(customAccessStartAt);
      console.log(`Using custom access start date: ${customAccessStartAt}`);
    } else if (order.created_at) {
      baseStartDate = new Date(order.created_at);
      console.log(`Using order created_at as base: ${order.created_at}`);
    }
    
    // Check for existing active subscription for this product to extend from
    let accessStartAt = baseStartDate;
    let existingProductSub = null;
    
    if (extendFromCurrent) {
      // PATCH: Added auto_renew to select for fallback guard in extend branch
      const { data: activeSub } = await supabase
        .from("subscriptions_v2")
        .select("id, access_end_at, status, tariff_id, product_id, auto_renew")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .eq("status", "active")
        .order("access_end_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSub?.access_end_at && new Date(activeSub.access_end_at) > now) {
        // ── TARIFF + bePaid SBS MATCH GUARD ─────────────────────────────
        // Extend существующей подписки разрешён ТОЛЬКО при совпадении tariff_id.
        // Дополнительно (PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05): для recurring
        // rebill (когда у order есть bepaid_subscription_id) обязателен ещё и
        // sbs match с активной подпиской — иначе платёж старой sbs может продлить
        // новую sub того же продукта (дефект Ларисы 12-13 мая 2026).
        const orderSbs = (order as any).bepaid_subscription_id || null;

        // Резолв sbs активной подписки: provider_subscriptions ИЛИ meta.bepaid_subscription_id.
        let activeSubSbs: string | null = null;
        if (orderSbs) {
          const { data: provLink } = await supabase
            .from('provider_subscriptions')
            .select('provider_subscription_id')
            .eq('subscription_v2_id', activeSub.id)
            .eq('provider', 'bepaid')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          activeSubSbs = (provLink as any)?.provider_subscription_id || null;
          if (!activeSubSbs) {
            const { data: subMetaRow } = await supabase
              .from('subscriptions_v2')
              .select('meta')
              .eq('id', activeSub.id)
              .maybeSingle();
            activeSubSbs = ((subMetaRow as any)?.meta || {}).bepaid_subscription_id || null;
          }
        }

        const tariffMatch =
          activeSub.product_id === productId &&
          activeSub.tariff_id != null &&
          tariffId != null &&
          activeSub.tariff_id === tariffId;

        const sbsMatch = !orderSbs ? true : (activeSubSbs && String(activeSubSbs) === String(orderSbs));
        const canExtendExistingSub = tariffMatch && sbsMatch;

        if (canExtendExistingSub) {
          // Extend from end of current access
          accessStartAt = new Date(activeSub.access_end_at);
          existingProductSub = activeSub;
          console.log(`[grant-access-for-order] Extending from existing access end: ${activeSub.access_end_at} (tariff+sbs match)`);
        } else {
          // Mismatch → НЕ extend.
          let skipReason: string;
          if (!tariffMatch) {
            skipReason =
              activeSub.tariff_id == null || tariffId == null
                ? "skip_extend_missing_tariff"
                : "skip_extend_tariff_mismatch";
          } else {
            skipReason = "skip_extend_bepaid_subscription_mismatch";
          }

          console.log(
            `[grant-access-for-order] ${skipReason}: active sub ${activeSub.id} ` +
            `(tariff=${activeSub.tariff_id}, sbs=${activeSubSbs}) vs order ` +
            `(tariff=${tariffId}, sbs=${orderSbs}). Создаю новую подписку от ${baseStartDate.toISOString()}.`
          );

          await supabase.from("audit_logs").insert({
            action: `grant-access-for-order.${skipReason}`,
            actor_type: "system",
            actor_user_id: null,
            actor_label: "grant-access-for-order",
            target_user_id: userId,
            meta: {
              order_id: orderId,
              product_id: productId,
              tariff_id: tariffId,
              order_bepaid_subscription_id: orderSbs,
              active_subscription_id: activeSub.id,
              active_subscription_access_end_at: activeSub.access_end_at,
              active_subscription_tariff_id: activeSub.tariff_id,
              active_subscription_bepaid_sbs: activeSubSbs,
              new_access_start_at: baseStartDate.toISOString(),
              tariff_match: tariffMatch,
              sbs_match: sbsMatch,
              reason:
                skipReason === "skip_extend_bepaid_subscription_mismatch"
                  ? "bePaid subscription_id mismatch — refusing to extend foreign sub via rebill"
                  : skipReason === "skip_extend_tariff_mismatch"
                  ? "Different tariff_id — new subscription instead of extending existing one"
                  : "Missing tariff_id on either side — defaulting to safe new subscription",
            },
          });

          // ── PATCH §F SBS-MISMATCH NO-NEW-SUB GUARD (2026-05) ───────────────
          // При recurring rebill с чужой sbs ЗАПРЕЩЕНО создавать новую sub-цепочку.
          // Только: audit + manual_review + ранний return. НИКАКИХ INSERT в
          // subscriptions_v2 / entitlements / access_rules / telegram_access_queue.
          // Tariff-mismatch ветка (без sbs) сохраняет прежнее поведение (создание
          // новой подписки от baseStartDate) — §F её не меняет.
          if (skipReason === "skip_extend_bepaid_subscription_mismatch") {
            // Собрать ВСЕХ кандидатов того же user+product для полноты audit.
            const { data: allCandidates } = await supabase
              .from("subscriptions_v2")
              .select("id, tariff_id, status, access_end_at, meta")
              .eq("user_id", userId)
              .eq("product_id", productId)
              .in("status", ["active", "trial", "past_due"]);
            const candidateIds: string[] = (allCandidates || []).map((c: any) => c.id);
            const candidateSbsList: Array<{ subscription_v2_id: string; bepaid_sbs: string | null; tariff_id: string | null; status: string }> =
              await Promise.all(
                (allCandidates || []).map(async (c: any) => {
                  const { data: pl } = await supabase
                    .from("provider_subscriptions")
                    .select("provider_subscription_id")
                    .eq("subscription_v2_id", c.id)
                    .eq("provider", "bepaid")
                    .order("updated_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  const sbs = (pl as any)?.provider_subscription_id
                    || ((c.meta || {}) as any).bepaid_subscription_id
                    || null;
                  return {
                    subscription_v2_id: c.id,
                    bepaid_sbs: sbs,
                    tariff_id: c.tariff_id,
                    status: c.status,
                  };
                })
              );

            const paymentFlowForAudit = resolvePaymentFlow(order);

            const auditPayload = buildSbsMismatchAuditPayload({
              orderId,
              productId,
              tariffId,
              paymentFlow: paymentFlowForAudit,
              orderSbs,
              primaryCandidateId: activeSub.id,
              primaryCandidateSbs: activeSubSbs,
              candidates: candidateSbsList,
            });

            // 1) Audit с полным контекстом (все кандидаты).
            await supabase.from("audit_logs").insert({
              ...auditPayload,
              target_user_id: userId,
            });

            // 2) Merge orders_v2.meta (manual_review).
            try {
              const mergedMeta = buildSbsMismatchOrderMetaMerge({
                existingMeta: ((order as any).meta || {}) as Record<string, unknown>,
                orderSbs,
                primaryCandidateId: activeSub.id,
                primaryCandidateSbs: activeSubSbs,
                candidates: candidateSbsList,
                paymentFlow: paymentFlowForAudit,
                nowIso: new Date().toISOString(),
              });
              await supabase
                .from("orders_v2")
                .update({ meta: mergedMeta })
                .eq("id", orderId);
            } catch (mrErr) {
              console.error("[grant-access-for-order] §F manual_review meta-merge failed (non-fatal):", mrErr);
            }

            // 3) Ранний return ДО любых INSERT в subscriptions_v2/entitlements/
            //    access_rules/telegram_access_queue. HTTP 200, без grant.
            console.log(
              `[grant-access-for-order] §F NO-NEW-SUB: order ${orderId} skipped, ` +
              `manual_review=true, candidates=${candidateIds.length}`
            );
            const responseBody = buildSbsMismatchResponseBody({
              orderSbs,
              primaryCandidateId: activeSub.id,
              primaryCandidateSbs: activeSubSbs,
              candidates: candidateSbsList,
            });
            return new Response(
              JSON.stringify(responseBody),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          // existingProductSub остаётся null, accessStartAt = baseStartDate
          // (только для tariff-mismatch / missing-tariff веток — не SBS-mismatch).
        }
      }
    }
    
    // Phase 1: Calculate access_end_at - calendar month from config, days for others
    let accessEndAt: Date;
    if (customAccessEndAt) {
      // PATCH: exact target end date takes priority over all other calculations
      accessEndAt = new Date(customAccessEndAt);
      console.log(`[grant-access-for-order] Using customAccessEndAt: ${accessEndAt.toISOString()}`);
    } else if (isClubProduct && !customAccessDays) {
      // PATCH: For renewals with existing subscription, align entitlement
      // with subscription.access_end_at (canonical SoT) instead of
      // calculating from order date which causes +30 day overshoot.
      if (existingProductSub?.access_end_at && extendFromCurrent) {
        // accessStartAt was already set to existingProductSub.access_end_at (line 287)
        // so calcCalendarMonthEnd(accessStartAt) gives the CORRECT new sub end.
        // But we must use that same date for entitlement too.
        accessEndAt = calcCalendarMonthEnd(accessStartAt);
        console.log(`[grant-access-for-order] Club renewal: entitlement aligned with sub end: ${accessStartAt.toISOString()} → ${accessEndAt.toISOString()}`);
      } else {
        accessEndAt = calcCalendarMonthEnd(accessStartAt);
        console.log(`[grant-access-for-order] Calendar month product (new): ${accessStartAt.toISOString()} → ${accessEndAt.toISOString()}`);
      }
    } else {
      // For non-calendar-month or custom days: use duration in days
      accessEndAt = new Date(accessStartAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    const results: any = {
      orderId,
      userId,
      productCode,
      durationDays,
      accessStartAt: accessStartAt.toISOString(),
      accessEndAt: accessEndAt.toISOString(),
      extendedFrom: existingProductSub?.id || null,
      entitlement: null,
      subscription: null,
      telegram: null,
      getcourse: null,
    };

    // 1. Upsert entitlement — canonical reconcile flow:
    //    a) lookup by (user_id, product_id) — ID-first (primary)
    //    b) fallback: lookup legacy row by (user_id, product_code) WHERE product_id IS NULL
    //       → backfill product_id (legacy reconciliation, allowed only when product_id IS NULL)
    //    c) if INSERT fails on duplicate(user_id, product_code) constraint → reread by code
    //       and treat as idempotent replay (merge, not fail)
    //
    // Invariants (entitlement_sync_engine):
    //   • expires_at NEVER decreases (GREATEST(existing, new))
    //   • status='active' on terminal completion
    //   • product_id of legacy row is filled in, never overwritten if already set
    //   • only access-window fields are touched on merge

    // Step (a): primary lookup by product_id
    let existingEntitlement: { id: string; expires_at: string | null; product_code: string | null; product_id: string | null; meta: Record<string, unknown> | null } | null = null;
    {
      const { data } = await supabase
        .from("entitlements")
        .select("id, expires_at, product_code, product_id, meta")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .maybeSingle();
      existingEntitlement = data as any;
    }

    // Step (b): legacy fallback — only if no row by product_id AND we have product_code
    let legacyBackfillNeeded = false;
    if (!existingEntitlement && productCode) {
      const { data: legacy } = await supabase
        .from("entitlements")
        .select("id, expires_at, product_code, product_id, meta")
        .eq("user_id", userId)
        .eq("product_code", productCode)
        .is("product_id", null)
        .maybeSingle();

      if (legacy) {
        // Safe to merge: product_id IS NULL, product_code matches expected.
        // Refuse merge if product_id is set to ANYTHING (even matching) — primary lookup
        // already handles the matching case; non-matching is a foreign row.
        existingEntitlement = legacy as any;
        legacyBackfillNeeded = true;
        console.log(`[grant-access] LEGACY BACKFILL: found entitlement ${legacy.id} (user=${userId}, code=${productCode}, product_id=NULL) → will backfill product_id=${productId}`);
      }
    }

    // Pre-INSERT: check for order_id collision (different product holding this order_id)
    const { data: orderIdCollision } = await supabase
      .from("entitlements")
      .select("id, product_code, product_id, user_id")
      .eq("order_id", orderId)
      .maybeSingle();

    if (orderIdCollision && orderIdCollision.product_id !== productId) {
      // STOP-guard: collision belongs to a different user → hard error
      if (orderIdCollision.user_id !== userId) {
        console.error(`[grant-access] HARD STOP: order_id ${orderId} collision on entitlement ${orderIdCollision.id} belongs to DIFFERENT user ${orderIdCollision.user_id}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: "order_id_collision_foreign_user",
            details: {
              order_id: orderId,
              collision_entitlement_id: orderIdCollision.id,
              collision_user_id: orderIdCollision.user_id,
              expected_user_id: userId,
            },
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Same user, different product → clear the stale order_id
      console.warn(`[grant-access] Clearing order_id collision: entitlement ${orderIdCollision.id} (product ${orderIdCollision.product_code}) held order_id ${orderId} meant for product ${productCode}`);
      await supabase
        .from("entitlements")
        .update({ order_id: null, updated_at: now.toISOString() })
        .eq("id", orderIdCollision.id);

      // Audit the collision clearing
      await supabase.from("audit_logs").insert({
        action: "entitlement.order_id_collision_cleared",
        actor_type: "system",
        actor_label: "grant-access-for-order",
        target_user_id: userId,
        meta: {
          order_id: orderId,
          previous_entitlement_id: orderIdCollision.id,
          previous_product_id: orderIdCollision.product_id,
          previous_product_code: orderIdCollision.product_code,
          correct_product_id: productId,
          correct_product_code: productCode,
          cleared_by_patch: "PATCH-GRANT-ACCESS-PRIMARY-ENTITLEMENT-EXACT-PRODUCT-FIX",
        },
      });
    }

    if (existingEntitlement) {
      // Merge existing entitlement — GREATEST(existing.expires_at, accessEndAt) — never decrease
      const newExpiresAt = existingEntitlement.expires_at &&
        new Date(existingEntitlement.expires_at) > accessEndAt
          ? existingEntitlement.expires_at
          : accessEndAt.toISOString();

      const prevMeta = (existingEntitlement.meta && typeof existingEntitlement.meta === 'object')
        ? existingEntitlement.meta as Record<string, unknown>
        : {};
      const mergedMeta: Record<string, unknown> = {
        ...prevMeta,
        granted_by: legacyBackfillNeeded ? "legacy_product_id_backfill" : "primary_order_fulfillment",
        granted_at: now.toISOString(),
        ...(legacyBackfillNeeded ? { legacy_product_id_backfilled: true } : {}),
      };
      // Persist tariff_id if order has one (writer-fix 2026-05; preserves existing tariff_id otherwise).
      if (tariffId) {
        mergedMeta.tariff_id = tariffId;
      }

      const updatePayload: Record<string, unknown> = {
        status: "active",
        expires_at: newExpiresAt,
        order_id: orderId,
        updated_at: now.toISOString(),
        meta: mergedMeta,
      };
      // Backfill product_id ONLY if the legacy row had it as NULL.
      if (legacyBackfillNeeded) {
        updatePayload.product_id = productId;
      }

      const { error: updateError } = await supabase
        .from("entitlements")
        .update(updatePayload)
        .eq("id", existingEntitlement.id);

      if (updateError) {
        console.error("Error updating entitlement:", updateError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "primary_entitlement_update_failed",
            details: updateError.message,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      results.entitlement = {
        action: legacyBackfillNeeded ? "legacy_backfilled" : "updated",
        id: existingEntitlement.id,
      };

      // Audit: tariff_id persisted (writer-fix 2026-05) — only when first set or actually changed
      if (tariffId && (prevMeta as Record<string, unknown>)?.tariff_id !== tariffId) {
        await supabase.from("audit_logs").insert({
          action: "entitlement.tariff_id_persisted",
          actor_type: "system",
          actor_label: "grant-access-for-order",
          target_user_id: userId,
          meta: {
            order_id: orderId,
            entitlement_id: existingEntitlement.id,
            product_id: productId,
            tariff_id: tariffId,
            previous_tariff_id: (prevMeta as Record<string, unknown>)?.tariff_id ?? null,
            branch: "update",
          },
        });
      }

      // Audit legacy backfill explicitly
      if (legacyBackfillNeeded) {
        await supabase.from("audit_logs").insert({
          action: "entitlement.legacy_product_id_backfilled",
          actor_type: "system",
          actor_label: "grant-access-for-order",
          target_user_id: userId,
          meta: {
            entitlement_id: existingEntitlement.id,
            order_id: orderId,
            product_id: productId,
            product_code: productCode,
            previous_product_id: null,
            new_expires_at: newExpiresAt,
          },
        });
      }
    } else {
      // Create new entitlement
      const { data: newEntitlement, error: insertError } = await supabase
        .from("entitlements")
        .insert({
          user_id: userId,
          profile_id: profileId || userId,
          product_code: productCode,
          product_id: productId || null,
          status: "active",
          order_id: orderId,
          expires_at: accessEndAt.toISOString(),
          meta: {
            granted_by: "primary_order_fulfillment",
            granted_at: now.toISOString(),
            ...(tariffId ? { tariff_id: tariffId } : {}),
          },
        })
        .select("id")
        .single();

      if (insertError) {
        // Idempotent replay path: duplicate by (user_id, product_code) unique constraint.
        // Reread by product_code (legacy or recently-created sibling) and merge.
        const isDuplicate =
          insertError.code === "23505" ||
          /duplicate key|entitlements_user_id_product_code_key/i.test(insertError.message || "");

        if (isDuplicate && productCode) {
          console.warn(`[grant-access] IDEMPOTENT REPLAY: insert duplicate on (user_id, product_code)=(${userId}, ${productCode}); rereading and merging.`);

          const { data: dupRow } = await supabase
            .from("entitlements")
            .select("id, expires_at, product_id, product_code, meta")
            .eq("user_id", userId)
            .eq("product_code", productCode)
            .maybeSingle();

          // Safety: only merge if product_id is NULL or matches our productId.
          // Foreign product_id with same product_code is a data anomaly → hard fail.
          if (!dupRow) {
            console.error(`[grant-access] IDEMPOTENT REPLAY FAILED: duplicate signaled but reread returned no row.`);
            return new Response(
              JSON.stringify({
                success: false,
                error: "primary_entitlement_creation_failed",
                details: insertError.message,
                context: { order_id: orderId, user_id: userId, product_id: productId },
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (dupRow.product_id && dupRow.product_id !== productId) {
            console.error(`[grant-access] IDEMPOTENT REPLAY HARD STOP: duplicate row ${dupRow.id} has foreign product_id=${dupRow.product_id} (expected ${productId}, code=${productCode}).`);
            return new Response(
              JSON.stringify({
                success: false,
                error: "entitlement_product_code_collision_foreign_product",
                details: {
                  entitlement_id: dupRow.id,
                  existing_product_id: dupRow.product_id,
                  expected_product_id: productId,
                  product_code: productCode,
                },
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const mergedExpires = dupRow.expires_at &&
            new Date(dupRow.expires_at) > accessEndAt
              ? dupRow.expires_at
              : accessEndAt.toISOString();

          const wasLegacy = dupRow.product_id === null;
          const dupPrevMeta = (dupRow.meta && typeof dupRow.meta === 'object')
            ? dupRow.meta as Record<string, unknown>
            : {};
          const dupMergedMeta: Record<string, unknown> = {
            ...dupPrevMeta,
            granted_by: "idempotent_replay_merge",
            granted_at: now.toISOString(),
            ...(wasLegacy ? { legacy_product_id_backfilled: true } : {}),
          };
          if (tariffId) {
            dupMergedMeta.tariff_id = tariffId;
          }
          const mergePayload: Record<string, unknown> = {
            status: "active",
            expires_at: mergedExpires,
            order_id: orderId,
            updated_at: now.toISOString(),
            meta: dupMergedMeta,
          };
          if (wasLegacy) mergePayload.product_id = productId;

          const { error: mergeErr } = await supabase
            .from("entitlements")
            .update(mergePayload)
            .eq("id", dupRow.id);

          if (mergeErr) {
            console.error("[grant-access] IDEMPOTENT REPLAY merge failed:", mergeErr);
            return new Response(
              JSON.stringify({
                success: false,
                error: "primary_entitlement_creation_failed",
                details: mergeErr.message,
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await supabase.from("audit_logs").insert({
            action: "grant_access.idempotent_replay",
            actor_type: "system",
            actor_label: "grant-access-for-order",
            target_user_id: userId,
            meta: {
              entitlement_id: dupRow.id,
              order_id: orderId,
              product_id: productId,
              product_code: productCode,
              was_legacy_null_product_id: wasLegacy,
              merged_expires_at: mergedExpires,
            },
          });

          results.entitlement = {
            action: wasLegacy ? "legacy_backfilled_via_replay" : "merged_via_replay",
            id: dupRow.id,
          };

          // Audit: tariff_id persisted via idempotent replay merge
          if (tariffId && (dupPrevMeta as Record<string, unknown>)?.tariff_id !== tariffId) {
            await supabase.from("audit_logs").insert({
              action: "entitlement.tariff_id_persisted",
              actor_type: "system",
              actor_label: "grant-access-for-order",
              target_user_id: userId,
              meta: {
                order_id: orderId,
                entitlement_id: dupRow.id,
                product_id: productId,
                tariff_id: tariffId,
                previous_tariff_id: (dupPrevMeta as Record<string, unknown>)?.tariff_id ?? null,
                branch: "idempotent_replay_merge",
              },
            });
          }
        } else {
          console.error("HARD ERROR creating entitlement:", insertError);
          return new Response(
            JSON.stringify({
              success: false,
              error: "primary_entitlement_creation_failed",
              details: insertError.message,
              context: { order_id: orderId, user_id: userId, product_id: productId },
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        results.entitlement = { action: "created", id: newEntitlement?.id };

        // Audit: tariff_id persisted on fresh insert
        if (tariffId && newEntitlement?.id) {
          await supabase.from("audit_logs").insert({
            action: "entitlement.tariff_id_persisted",
            actor_type: "system",
            actor_label: "grant-access-for-order",
            target_user_id: userId,
            meta: {
              order_id: orderId,
              entitlement_id: newEntitlement.id,
              product_id: productId,
              tariff_id: tariffId,
              previous_tariff_id: null,
              branch: "insert",
            },
          });
        }
      }
    }

    // Post-check: verify primary entitlement exists with correct product_id
    const { data: verifiedEntitlement } = await supabase
      .from("entitlements")
      .select("id, product_id")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .eq("status", "active")
      .single();

    if (!verifiedEntitlement || verifiedEntitlement.product_id !== productId) {
      console.error(`[grant-access] PRIMARY ENTITLEMENT VERIFICATION FAILED: user=${userId}, product_id=${productId}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: "primary_entitlement_verification_failed",
          details: { user_id: userId, product_id: productId, found: verifiedEntitlement },
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    results.primary_entitlement_verified = true;

    // 2. Find user's active payment method to enable auto-renewal
    const { data: userPaymentMethod } = await supabase
      .from("payment_methods")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("is_default", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasPaymentMethod = !!userPaymentMethod?.id;

    // PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX: Determine auto_renew from order context, NOT hardcoded
    // payment_flow in order.meta is the SoT for whether this is a subscription checkout
    const orderMeta = (order.meta || {}) as Record<string, any>;
    const paymentFlow = orderMeta.payment_flow || '';
    const isSubscriptionFlow = paymentFlow.includes('subscription') || paymentFlow === 'provider_managed_checkout';
    // auto_renew = true ONLY if subscription flow AND user has payment method
    const shouldAutoRenew = isSubscriptionFlow && hasPaymentMethod;
    console.log(`User ${userId} payment method: ${userPaymentMethod?.id || 'none'}, payment_flow: ${paymentFlow}, isSubscriptionFlow: ${isSubscriptionFlow}, auto_renew: ${shouldAutoRenew}`);

    // PATCH-ORDER-BASED-SKIP-SUB: Check entitlement_mode from products_v2.
    // If product is order_based_only, skip subscription creation/extension entirely.
    const { data: productEntMode } = await supabase
      .from('products_v2')
      .select('entitlement_mode')
      .eq('id', productId)
      .maybeSingle();

    const isOrderBasedOnly = productEntMode?.entitlement_mode === 'order_based_only';

    if (isOrderBasedOnly) {
      console.log(`[grant-access-for-order] SKIP subscription: product ${productId} is order_based_only`);
      results.subscription = { action: 'skipped', reason: 'order_based_only' };

      await supabase.from('audit_logs').insert({
        action: 'grant-access-for-order.subscription_skipped',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'grant-access-for-order',
        target_user_id: userId,
        meta: {
          order_id: orderId,
          product_id: productId,
          entitlement_mode: 'order_based_only',
          reason: 'order_based_only products do not create subscriptions',
        },
      });
    } else

    // 3. Create or UPDATE subscription - use existingProductSub to avoid duplicates!
    // If there's already an active subscription for this user+product, EXTEND it instead of creating new
    if (existingProductSub) {
      // EXTEND existing subscription (don't create duplicate)
      const { data: fullExistingSub } = await supabase
        .from("subscriptions_v2")
        .select("id, payment_method_id, meta, tariff_id")
        .eq("id", existingProductSub.id)
        .single();

      const existingMeta = (fullExistingSub?.meta || {}) as Record<string, any>;
      const extendedByOrders = existingMeta.extended_by_orders || [];
      
      // SOT-aligned snapshot resolver on EXTEND.
      // Read-only helper: never writes to orders_v2.offer_id.
      // Decision matrix: order.offer_id → tariff active recurring offer → no snapshot.
      let extendRecurringSnapshot = existingMeta.recurring_snapshot;
      let extendResolverDecision: {
        offer_id: string | null;
        tariff_id: string | null;
        resolved_offer_id: string | null;
        is_recurring: boolean;
        decision: string;
      } = {
        offer_id: order.offer_id || null,
        tariff_id: tariffId || null,
        resolved_offer_id: null,
        is_recurring: false,
        decision: 'snapshot_already_present',
      };

      if (!extendRecurringSnapshot) {
        const resolved = await resolveRecurringFromOrderOrTariff(
          supabase,
          order.offer_id,
          tariffId
        );
        extendResolverDecision = {
          offer_id: order.offer_id || null,
          tariff_id: tariffId || null,
          resolved_offer_id: resolved.resolved_offer_id,
          is_recurring: resolved.is_recurring,
          decision: resolved.decision,
        };

        if (resolved.is_recurring && resolved.snapshot) {
          extendRecurringSnapshot = resolved.snapshot;

          if (resolved.decision === 'resolved_from_tariff') {
            await supabase.from('audit_logs').insert({
              action: 'subscription.recurring_snapshot_resolved_from_tariff',
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'grant-access-for-order',
              target_user_id: userId,
              meta: {
                subscription_id: existingProductSub.id,
                order_id: orderId,
                context: 'extend_branch',
                ...extendResolverDecision,
              },
            });
          }
        } else if (resolved.is_recurring && !resolved.snapshot_complete) {
          // Real data defect: recurring offer exists but snapshot is incomplete
          await supabase.from('audit_logs').insert({
            action: 'subscription.recurring_snapshot_fallback_used',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'grant-access-for-order',
            target_user_id: userId,
            meta: {
              subscription_id: existingProductSub.id,
              order_id: orderId,
              reason: 'recurring_offer_present_but_snapshot_incomplete',
              context: 'extend_branch',
              ...extendResolverDecision,
            },
          });
        }
        // If not recurring per SOT — do NOT create a snapshot, do NOT audit fallback.
      }

      const updateData: Record<string, any> = {
        status: "active",
        access_end_at: accessEndAt.toISOString(),
        next_charge_at: accessEndAt.toISOString(),
        updated_at: now.toISOString(),
        meta: {
          ...existingMeta,
          extended_by_orders: [...extendedByOrders, orderId],
          last_extension_at: now.toISOString(),
          last_extension_days: durationDays,
          // PATCH 14: Preserve recurring_amount from order
          recurring_amount: existingMeta.recurring_amount || order.final_price,
          recurring_currency: existingMeta.recurring_currency || order.currency || 'BYN',
          // PATCH: Ensure recurring_snapshot exists
          recurring_snapshot: extendRecurringSnapshot,
        },
      };

      // Update tariff if new order has different tariff
      if (tariffId && tariffId !== fullExistingSub?.tariff_id) {
        updateData.tariff_id = tariffId;
      }

      // Attach payment method if not present — auto_renew from SoT, not hardcoded
      if (!fullExistingSub?.payment_method_id && hasPaymentMethod) {
        updateData.payment_method_id = userPaymentMethod.id;
        // PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX: only enable auto_renew if subscription flow
        updateData.auto_renew = shouldAutoRenew;
      }

      const { error: updateSubError } = await supabase
        .from("subscriptions_v2")
        .update(updateData)
        .eq("id", existingProductSub.id);

      if (updateSubError) {
        console.error("Error extending subscription:", updateSubError);
      } else {
        console.log(`Extended subscription ${existingProductSub.id} to ${accessEndAt.toISOString()}`);
        results.subscription = { 
          action: "extended", 
          id: existingProductSub.id,
          extended_by_order: orderId,
          new_end_date: accessEndAt.toISOString(),
        };
      }
    } else {
    // CREATE new subscription (no active subscription for this user+product)
      // SOT-aligned snapshot resolver. Strict: classification by tariff_offers.meta.recurring.is_recurring.
      // hasPaymentMethod / requires_card_tokenization are NOT classifiers.
      // For one-time products: no snapshot, no fallback audit, no _missing audit.

      const resolved = await resolveRecurringFromOrderOrTariff(
        supabase,
        order.offer_id,
        tariffId
      );

      const resolverDecision = {
        offer_id: order.offer_id || null,
        tariff_id: tariffId || null,
        resolved_offer_id: resolved.resolved_offer_id,
        is_recurring: resolved.is_recurring,
        decision: resolved.decision,
      };

      let recurringSnapshot: Record<string, any> | null = null;

      if (resolved.is_recurring && resolved.snapshot) {
        recurringSnapshot = resolved.snapshot;
        console.log(`[grant-access-for-order] recurring_snapshot resolved (${resolved.decision}) for order ${orderId}`);

        // Audit info-level resolve from tariff (helper acted as fallback path,
        // because writer did not pass offer_id, but SOT confirmed recurring).
        if (resolved.decision === 'resolved_from_tariff') {
          await supabase.from('audit_logs').insert({
            action: 'subscription.recurring_snapshot_resolved_from_tariff',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'grant-access-for-order',
            target_user_id: userId,
            meta: {
              order_id: orderId,
              context: 'create_branch',
              ...resolverDecision,
            },
          });
        }
      } else if (resolved.is_recurring && !resolved.snapshot_complete) {
        // Real data defect: recurring offer exists, but meta.recurring is incomplete.
        console.warn(`[grant-access-for-order] recurring offer present but snapshot incomplete for order ${orderId}`);
        await supabase.from('audit_logs').insert({
          action: 'subscription.recurring_snapshot_fallback_used',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'grant-access-for-order',
          target_user_id: userId,
          meta: {
            order_id: orderId,
            reason: 'recurring_offer_present_but_snapshot_incomplete',
            context: 'create_branch',
            ...resolverDecision,
          },
        });
      }
      // else: SOT says one-time → no snapshot, no audit. Silent and clean.

      // GUARD A (PATCH-KOROLYOVA): If accessEndAt is stale (in the past),
      // set a safe 48h placeholder to prevent immediate revoke by cron
      // before bePaid sync can update the real date.
      let safeAccessEndAt = accessEndAt;
      const STALE_GUARD_HOURS = 48;
      if (accessEndAt < now) {
        const placeholder = new Date(now.getTime() + STALE_GUARD_HOURS * 60 * 60 * 1000);
        console.warn(`[grant-access-for-order] GUARD A: accessEndAt ${accessEndAt.toISOString()} is in the past. Overriding to ${placeholder.toISOString()} (${STALE_GUARD_HOURS}h safe placeholder)`);
        safeAccessEndAt = placeholder;

        await supabase.from('audit_logs').insert({
          action: 'subscription.stale_date_overridden',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'grant-access-for-order',
          target_user_id: userId,
          meta: {
            order_id: orderId,
            original_access_end_at: accessEndAt.toISOString(),
            overridden_to: placeholder.toISOString(),
            reason: 'stale_provider_date_guard',
            guard: 'GUARD_A_KOROLYOVA',
          },
        });
      }

      const { data: newSub, error: createSubError } = await supabase
        .from("subscriptions_v2")
        .insert({
          user_id: userId,
          profile_id: profileId,
          order_id: orderId,
          product_id: productId,
          tariff_id: tariffId,
          status: "active",
          access_start_at: accessStartAt.toISOString(),
          access_end_at: safeAccessEndAt.toISOString(),
          next_charge_at: accessEndAt.toISOString(),
          payment_method_id: hasPaymentMethod ? userPaymentMethod.id : null,
          auto_renew: shouldAutoRenew, // PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX: from payment_flow, not hardcoded
          meta: {
            granted_by: "grant-access-for-order",
            granted_at: now.toISOString(),
            initial_order_id: orderId,
            recurring_amount: await getRecurringAmount(order, supabase),
            recurring_currency: order.currency || 'BYN',
            recurring_snapshot: recurringSnapshot,
          },
        })
        .select("id")
        .single();

      if (createSubError) {
        console.error("Error creating subscription:", createSubError);
      } else {
        console.log(`Created new subscription ${newSub?.id} for user ${userId}, product ${productId}`);
        results.subscription = { action: "created", id: newSub?.id, auto_renew: shouldAutoRenew, payment_flow: paymentFlow };
      }
    }

    // PATCH: Disable auto_renew on OLD subscriptions for same product (manual payment cleans up grace)
    // BLOCKER FIX: Skip this cleanup for staff accounts to protect internal access
    const newSubId = results.subscription?.id;
    if (newSubId) {
      // First check if this user is staff
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('user_id', userId)
        .maybeSingle();
      
      const userEmail = userProfile?.email?.toLowerCase() || '';
      const isStaff = STAFF_EMAILS.some(se => se.toLowerCase() === userEmail);
      
      if (isStaff) {
        console.log(`SKIP cleanup for staff user ${userId} (${userEmail})`);
        results.staff_exclusion = true;
      } else {
        const { data: oldSubs } = await supabase
          .from('subscriptions_v2')
          .select('id, grace_period_status')
          .eq('user_id', userId)
          .eq('product_id', productId)
          .eq('auto_renew', true)
          .neq('id', newSubId);

        if (oldSubs?.length) {
          for (const oldSub of oldSubs) {
            await supabase.from('subscriptions_v2').update({
              auto_renew: false,
              grace_period_started_at: null,
              grace_period_ends_at: null,
              grace_period_status: null,
              updated_at: now.toISOString(),
              meta: {
                replaced_by_order: orderId,
                auto_renew_disabled_at: now.toISOString(),
                auto_renew_disabled_reason: 'manual_payment_new_order',
              },
            }).eq('id', oldSub.id);
          }
          console.log(`Disabled auto_renew for ${oldSubs.length} old subscriptions after manual payment`);
          results.old_subscriptions_disabled = oldSubs.length;
        }
      }
    }

    // Pre-declare ledger keys for telegram lineage (populated later in step 7)
    let grantLedgerExecutionKey: string | null = null;
    let grantLedgerSourceEventKey: string | null = `gafo:webhook:${orderId}`;

    // 3. Try to grant Telegram access if applicable
    if (grantTelegram) {
      try {
        // Phase v23: Read from access_rules first, fallback to legacy product_club_mappings
        let clubId: string | null = null;

        // Helper: check prior_purchase condition on a rule
        const checkPriorPurchaseCondition = async (ruleConditions: any, ruleId: string): Promise<boolean> => {
          if (!ruleConditions || ruleConditions.condition_type !== 'prior_purchase') {
            return true; // No condition = unconditional
          }
          const requiredProductId = ruleConditions.required_product_id;
          const requiredTariffId = ruleConditions.required_tariff_id;
          if (!requiredProductId) return true;

          let query = supabase
            .from('orders_v2')
            .select('id')
            .eq('user_id', userId)
            .eq('product_id', requiredProductId)
            .eq('status', 'paid')
            .limit(1);
          
          if (requiredTariffId) {
            query = query.eq('tariff_id', requiredTariffId);
          }

          const { data: priorOrder } = await query.maybeSingle();
          const conditionMet = !!priorOrder;
          
          console.log(`[grant-access] Conditional rule ${ruleId}: prior_purchase check for product ${requiredProductId}${requiredTariffId ? ` tariff ${requiredTariffId}` : ''} → ${conditionMet ? 'PASSED' : 'FAILED'}`);
          
          if (!conditionMet) {
            // Write ledger entry for skipped condition
            try {
              await writeLedgerEntry(supabase, {
                source_event_type: 'webhook',
                source_event_key: `gafo:condition_skip:${orderId}:${ruleId}`,
                source_subject_type: 'order',
                source_subject_ref: orderId,
                source_order_id: orderId,
                action_type: 'grant',
                reason_code: 'no_matching_target',
                target_type: 'club',
                target_key: `${userId}:condition_check`,
                user_id: userId,
                profile_id: profileId || null,
                order_id: orderId,
                status: 'skipped',
                result: {
                  condition_type: 'prior_purchase',
                  required_product_id: requiredProductId,
                  required_tariff_id: requiredTariffId || null,
                  check_result: false,
                },
              });
            } catch (ledgerErr) {
              console.error('[grant-access] Ledger write for condition skip failed:', ledgerErr);
            }
          }
          
          return conditionMet;
        };

        // Try new rules layer (tariff-level first, then product-level)
        if (tariffId) {
          const { data: tariffRules } = await supabase
            .from("access_rules")
            .select("id, target_ref, conditions")
            .eq("tariff_id", tariffId)
            .eq("grant_target_type", "club")
            .eq("is_active", true)
            .order("priority", { ascending: false });
          
          if (tariffRules?.length) {
            for (const rule of tariffRules) {
              const conditionOk = await checkPriorPurchaseCondition(rule.conditions, rule.id);
              if (conditionOk && rule.target_ref) {
                clubId = rule.target_ref;
                console.log(`[grant-access] Club from access_rules (tariff): ${clubId}`);
                break;
              }
            }
          }
        }
        if (!clubId && productId) {
          const { data: productRules } = await supabase
            .from("access_rules")
            .select("id, target_ref, conditions")
            .eq("product_id", productId)
            .is("tariff_id", null)
            .eq("grant_target_type", "club")
            .eq("is_active", true)
            .order("priority", { ascending: false });
          
          if (productRules?.length) {
            for (const rule of productRules) {
              const conditionOk = await checkPriorPurchaseCondition(rule.conditions, rule.id);
              if (conditionOk && rule.target_ref) {
                clubId = rule.target_ref;
                console.log(`[grant-access] Club from access_rules (product): ${clubId}`);
                break;
              }
            }
          }
        }

        // Legacy fallback to product_club_mappings REMOVED — all club grants must come from access_rules
        // If no club rule found, no club access is granted (default-deny)
        if (!clubId) {
          console.log(`[grant-access] No club rule found in access_rules for product ${productId} — no club grant (default-deny)`);
        }

        if (clubId) {
          const telegramResponse = await fetch(`${supabaseUrl}/functions/v1/telegram-grant-access`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              user_id: userId,
              club_id: clubId,
              source_id: orderId,
              source: 'grant-access-for-order',
              // Sub-patch B: Pass parent lineage from ledger write
              parent_event_key: grantLedgerSourceEventKey || null,
              parent_execution_key: grantLedgerExecutionKey || null,
              _from_primary_path: !!(grantLedgerSourceEventKey && grantLedgerExecutionKey),
            }),
          });

          if (telegramResponse.ok) {
            const telegramResult = await telegramResponse.json();
            results.telegram = telegramResult;
          }
        }
      } catch (telegramError) {
        console.error("Telegram access error (non-critical):", telegramError);
        results.telegram = { error: String(telegramError) };
      }
    }

    // 3b. Process product_access rules via canonical shared helper.
    // SOT: _shared/product-access-grants.ts → syncSecondaryProductAccessForUser.
    // No inline grant logic — single write-path, idempotent, ledger-aware.
    // The helper aligns secondary entitlements with the FRESH source subscription window
    // (re-read after primary subscription was created/extended above).
    try {
      const paRules = await resolveProductAccessRules(
        supabase,
        productId,
        tariffId || null,
      );

      if (paRules.length === 0) {
        results.product_access = { skipped: 'no_rules' };
      } else {
        // Resolve canonical source subscription AFTER primary write,
        // so helper sees the just-extended access_end_at (canonical SoT:
        // MAX access_end_at across active+past_due, tariff_id-matched).
        let sourceSub: { id: string; access_end_at: string | null } | null = null;
        const newSubIdLocal = results.subscription?.id || null;
        if (newSubIdLocal) {
          const { data: subRow } = await supabase
            .from('subscriptions_v2')
            .select('id, access_end_at')
            .eq('id', newSubIdLocal)
            .maybeSingle();
          if (subRow) sourceSub = { id: subRow.id, access_end_at: subRow.access_end_at };
        }
        if (!sourceSub) {
          const { data: subRow } = await supabase
            .from('subscriptions_v2')
            .select('id, access_end_at')
            .eq('user_id', userId)
            .eq('product_id', productId)
            .in('status', ['active', 'past_due'])
            .order('access_end_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          if (subRow) sourceSub = { id: subRow.id, access_end_at: subRow.access_end_at };
        }

        const secondaryActions = await syncSecondaryProductAccessForUser(supabase, {
          userId,
          profileId: profileId || null,
          sourceProductId: productId,
          sourceTariffId: tariffId || null,
          sourceSubscription: sourceSub,
          rules: paRules,
          excludeOrderId: orderId,
          // No prior_purchase cache in single webhook flow → helper uses canonical
          // checkPriorPurchase fallback (orders_v2 paid + module_list_mapped).
          ctx: {
            sourceEventType: 'webhook',
            sourceSubjectType: 'order',
            sourceEventKeyPrefix: `gafo:product_access:${orderId}`,
            orderId,
            allowReduceAccess: false,
          },
        });

        const outcomeBuckets = secondaryActions.reduce((acc: Record<string, number>, a: any) => {
          acc[a.outcome] = (acc[a.outcome] || 0) + 1;
          return acc;
        }, {});

        results.product_access = {
          rule_count: paRules.length,
          source_subscription_id: sourceSub?.id || null,
          source_access_end_at: sourceSub?.access_end_at || null,
          actions_count: secondaryActions.length,
          outcomes: outcomeBuckets,
          actions: secondaryActions,
        };

        const failedCount = outcomeBuckets.failed || 0;
        if (failedCount > 0) {
          console.error(`[grant-access] product_access helper reported ${failedCount} failures for order ${orderId}`);
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_label: 'grant-access-for-order',
            action: 'grant_access.product_access_helper_failures',
            target_user_id: userId,
            meta: {
              order_id: orderId,
              product_id: productId,
              tariff_id: tariffId,
              outcomes: outcomeBuckets,
              severity: 'WARNING',
            },
          });
        }
      }
    } catch (productAccessError) {
      console.error("[grant-access] Product access helper error (non-critical):", productAccessError);
      results.product_access = { error: String(productAccessError) };
    }

    // 4. Try to sync with GetCourse if applicable
    if (grantGetcourse && order.offer_id) {
      try {
        const getcourseResponse = await fetch(`${supabaseUrl}/functions/v1/getcourse-grant-access`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            orderId,
            dryRun: false,
          }),
        });

        if (getcourseResponse.ok) {
          const getcourseResult = await getcourseResponse.json();
          results.getcourse = getcourseResult;
        }
      } catch (getcourseError) {
        console.error("GetCourse sync error (non-critical):", getcourseError);
      results.getcourse = { error: String(getcourseError) };
    }
  }

  // 5. Convert any preregistrations to "converted" status
  try {
    const { data: convertedPrereg, error: preregError } = await supabase
      .from("course_preregistrations")
      .update({ 
        status: "converted",
        updated_at: now.toISOString(),
      })
      .eq("user_id", userId)
      .eq("product_code", productCode)
      .in("status", ["new", "contacted"])
      .select("id");

    if (preregError) {
      console.error("Error converting preregistrations (non-critical):", preregError);
    } else if (convertedPrereg?.length) {
      console.log(`Converted ${convertedPrereg.length} preregistrations for user ${userId}`);
      results.preregistrations_converted = convertedPrereg.length;
    }
  } catch (preregConvertError) {
    console.error("Preregistration convert error (non-critical):", preregConvertError);
  }

  // 6. Add audit log
  try {
    await supabase.from("audit_logs").insert({
      actor_type: "admin",
      actor_label: "grant-access-for-order",
      action: "admin.grant_access",
      target_user_id: userId,
      meta: {
        order_id: orderId,
        product_id: productId,
        tariff_id: tariffId,
        duration_days: durationDays,
        access_start_at: accessStartAt.toISOString(),
        access_end_at: accessEndAt.toISOString(),
        extended_from: existingProductSub?.id || null,
        grant_telegram: grantTelegram,
        grant_getcourse: grantGetcourse,
        preregistrations_converted: results.preregistrations_converted || 0,
      },
    });
  } catch (auditError) {
    console.error("Audit log error (non-critical):", auditError);
  }

  // 7. Phase 1: Write ledger entry
  try {
    const actionType = existingProductSub ? 'extend' : 'grant';
    
    const postCheck = buildPostCheck({
      entitlement: { status: results.entitlement?.action || 'unknown', ref: results.entitlement?.id },
      telegram: grantTelegram ? { status: 'pending_downstream' } : undefined,
      subscription: { status: results.subscription?.action || 'unknown', ref: results.subscription?.id },
      ledgerRow: { status: 'written' },
      targetResolution: { status: 'matched', ref: productId },
    });

    const ledgerStatus = actionType === 'grant' ? 'granted' : 'extended';

    const ledgerResult = await writeLedgerEntry(supabase, {
      source_event_type: 'webhook',
      source_event_key: grantLedgerSourceEventKey,
      source_subject_type: 'order',
      source_subject_ref: orderId,
      source_order_id: orderId,
      source_offer_id: order.offer_id || null,
      action_type: actionType,
      reason_code: 'paid_order',
      target_type: 'product',
      target_key: `${userId}:${productId}`,
      target_ref: results.subscription?.id || null,
      user_id: userId,
      profile_id: profileId || null,
      order_id: orderId,
      status: ledgerStatus,
      result: {
        access_start: accessStartAt.toISOString(),
        access_end: accessEndAt.toISOString(),
        window_days: durationDays,
        source_window_rule: isClubProduct ? 'calendar_month' : (tariff?.access_days ? 'tariff_duration' : 'default_30d'),
        previous_end: existingProductSub?.access_end_at || null,
        post_check: postCheck,
      },
    });
    grantLedgerExecutionKey = ledgerResult.execution_key;
  } catch (ledgerError) {
    console.error("[grant-access-for-order] Ledger write error:", ledgerError);
  }

  // Sub-patch B: Idempotent skip guard — if execution_key is null, try to recover
  if (!grantLedgerExecutionKey && grantLedgerSourceEventKey) {
    try {
      const { data: existingLedger } = await supabase
        .from('access_grant_ledger')
        .select('execution_key')
        .eq('source_event_key', grantLedgerSourceEventKey)
        .limit(1)
        .maybeSingle();
      if (existingLedger?.execution_key) {
        grantLedgerExecutionKey = existingLedger.execution_key;
        console.log('[grant-access-for-order] Recovered execution_key from existing ledger row');
      }
    } catch (recoveryErr) {
      console.error('[grant-access-for-order] Execution key recovery error:', recoveryErr);
    }
  }

    // ──────────────────────────────────────────────────────────────────────
    // Sprint 3/4: canonical-document-payment-hook (fire-and-forget, fail-soft)
    // Двойной флаг внутри hook'а гарантирует no-op при выключенных настройках.
    // НИКОГДА не throw'ит наружу — оплата/доступ не должны ломаться.
    // ──────────────────────────────────────────────────────────────────────
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && serviceKey && orderId) {
        // Не await'им результат — fire-and-forget. Hook сам всегда возвращает 200.
        fetch(`${supabaseUrl}/functions/v1/canonical-document-payment-hook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ order_id: orderId }),
        }).catch((e) => console.warn('[grant-access-for-order] canonical-doc-hook fire-and-forget error:', e?.message || e));
      }
    } catch (hookErr) {
      console.warn('[grant-access-for-order] canonical-doc-hook scheduling error (ignored):', hookErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Доступы успешно выданы",
        results
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error granting access:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
