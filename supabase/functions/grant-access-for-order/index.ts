import { createClient } from "npm:@supabase/supabase-js@2";
import { isCalendarMonthProduct, calcCalendarMonthEnd } from '../_shared/resolve-access-window.ts';
import { writeLedgerEntry, buildPostCheck } from '../_shared/fulfillment-executor.ts';
import { checkPriorPurchase } from '../_shared/check-prior-purchase.ts';

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

    if (entitlementMatchesProduct && (subscriptionMatchesOrder || subscriptionExtendedByOrder)) {
      const guardSource = subscriptionMatchesOrder ? "order_id" : "extended_by_orders";
      console.log(`[grant-access] IDEMPOTENCY GUARD: order ${orderId} already fulfilled (product ${productId}, match via ${guardSource}). Entitlement: ${existingEntByOrder.id}, Subscription: ${resolvedSubscription!.id}. Strict no-op.`);

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
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          already_fulfilled: true,
          message: "Доступ по этому заказу уже был выдан ранее",
          existing: {
            entitlement_id: existingEntByOrder.id,
            subscription_id: resolvedSubscription!.id,
            guard_match_source: guardSource,
          },
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
        .select("id, access_end_at, status, tariff_id, auto_renew")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .eq("status", "active")
        .order("access_end_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSub?.access_end_at && new Date(activeSub.access_end_at) > now) {
        // ── TARIFF-MATCH GUARD ──────────────────────────────────────────
        // Extend существующей подписки разрешён ТОЛЬКО при совпадении tariff_id.
        // Покупка другого тарифа того же продукта = новая подписка от даты оплаты,
        // без суммирования остатка дней. Замена тарифа — только через explicit
        // cancel → supersede администратором (safe-replacement-flow).
        const canExtendExistingSub =
          activeSub.product_id === productId &&
          activeSub.tariff_id != null &&
          tariffId != null &&
          activeSub.tariff_id === tariffId;

        if (canExtendExistingSub) {
          // Extend from end of current access
          accessStartAt = new Date(activeSub.access_end_at);
          existingProductSub = activeSub;
          console.log(`[grant-access-for-order] Extending from existing access end: ${activeSub.access_end_at} (tariff match: ${tariffId})`);
        } else {
          // Tariff mismatch (или одна из сторон без tariff_id) → НЕ extend.
          // Создаём новую подписку от baseStartDate. Старая подписка остаётся как есть.
          const skipReason =
            activeSub.tariff_id == null || tariffId == null
              ? "skip_extend_missing_tariff"
              : "skip_extend_tariff_mismatch";

          console.log(
            `[grant-access-for-order] ${skipReason}: active sub ${activeSub.id} ` +
            `(tariff=${activeSub.tariff_id}) != order tariff=${tariffId}. ` +
            `Создаю новую подписку от ${baseStartDate.toISOString()} вместо extend.`
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
              active_subscription_id: activeSub.id,
              active_subscription_access_end_at: activeSub.access_end_at,
              active_subscription_tariff_id: activeSub.tariff_id,
              new_order_tariff_id: tariffId,
              new_access_start_at: baseStartDate.toISOString(),
              reason:
                skipReason === "skip_extend_tariff_mismatch"
                  ? "Different tariff_id — new subscription instead of extending existing one"
                  : "Missing tariff_id on either side — defaulting to safe new subscription",
            },
          });
          // existingProductSub остаётся null, accessStartAt = baseStartDate
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
    let existingEntitlement: { id: string; expires_at: string | null; product_code: string | null; product_id: string | null } | null = null;
    {
      const { data } = await supabase
        .from("entitlements")
        .select("id, expires_at, product_code, product_id")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .maybeSingle();
      existingEntitlement = data;
    }

    // Step (b): legacy fallback — only if no row by product_id AND we have product_code
    let legacyBackfillNeeded = false;
    if (!existingEntitlement && productCode) {
      const { data: legacy } = await supabase
        .from("entitlements")
        .select("id, expires_at, product_code, product_id")
        .eq("user_id", userId)
        .eq("product_code", productCode)
        .is("product_id", null)
        .maybeSingle();

      if (legacy) {
        // Safe to merge: product_id IS NULL, product_code matches expected.
        // Refuse merge if product_id is set to ANYTHING (even matching) — primary lookup
        // already handles the matching case; non-matching is a foreign row.
        existingEntitlement = legacy;
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

      const updatePayload: Record<string, unknown> = {
        status: "active",
        expires_at: newExpiresAt,
        order_id: orderId,
        updated_at: now.toISOString(),
        meta: {
          granted_by: legacyBackfillNeeded ? "legacy_product_id_backfill" : "primary_order_fulfillment",
          granted_at: now.toISOString(),
          ...(legacyBackfillNeeded ? { legacy_product_id_backfilled: true } : {}),
        },
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
            .select("id, expires_at, product_id, product_code")
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
          const mergePayload: Record<string, unknown> = {
            status: "active",
            expires_at: mergedExpires,
            order_id: orderId,
            updated_at: now.toISOString(),
            meta: {
              granted_by: "idempotent_replay_merge",
              granted_at: now.toISOString(),
              ...(wasLegacy ? { legacy_product_id_backfilled: true } : {}),
            },
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
      
      // PATCH: Ensure recurring_snapshot exists on extend (fallback if missing)
      const DEFAULT_RECURRING_SNAPSHOT_EXTEND = {
        is_recurring: true,
        timezone: 'Europe/Minsk',
        billing_period_mode: 'month',
        grace_hours: 72,
        charge_attempts_per_day: 2,
        charge_times_local: ['09:00', '21:00'],
        pre_due_reminders_days: [7, 3, 1],
        notify_before_each_charge: true,
        notify_grace_events: true,
      };
      
      let extendRecurringSnapshot = existingMeta.recurring_snapshot;
      
      // PATCH: Fallback only if auto_renew=true (guard for extend branch)
      const shouldAddFallbackSnapshot = !extendRecurringSnapshot && existingProductSub?.auto_renew === true;
      
      if (shouldAddFallbackSnapshot) {
        // Try to get from offer if available
        if (order.offer_id) {
          const { data: offerData } = await supabase
            .from('tariff_offers')
            .select('meta')
            .eq('id', order.offer_id)
            .maybeSingle();
          extendRecurringSnapshot = offerData?.meta?.recurring || null;
        }
        // Fallback to default
        if (!extendRecurringSnapshot) {
          extendRecurringSnapshot = DEFAULT_RECURRING_SNAPSHOT_EXTEND;
          console.log(`[grant-access-for-order] Added fallback recurring_snapshot on extend for sub ${existingProductSub.id}`);
          
          // PATCH: SYSTEM ACTOR Proof for fallback in extend branch
          await supabase.from('audit_logs').insert({
            action: 'subscription.recurring_snapshot_fallback_used',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'grant-access-for-order',
            target_user_id: userId,
            meta: { 
              subscription_id: existingProductSub.id,
              order_id: orderId, 
              reason: 'extend_missing_snapshot',
              context: 'extend_branch',
              auto_renew: existingProductSub.auto_renew,
            },
          });
        }
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
      // PATCH 14: Save recurring_amount for consistent auto-renewals
      // PATCH: Save recurring_snapshot from offer for grace period config
      // PATCH: Fallback to default snapshot if no offer found, but only for likely subscriptions
      
      const DEFAULT_RECURRING_SNAPSHOT = {
        is_recurring: true,
        timezone: 'Europe/Minsk',
        billing_period_mode: 'month',
        grace_hours: 72,
        charge_attempts_per_day: 2,
        charge_times_local: ['09:00', '21:00'],
        pre_due_reminders_days: [7, 3, 1],
        notify_before_each_charge: true,
        notify_grace_events: true,
      };
      
      let recurringSnapshot = null;
      
      // 1) Try to get from offer
      if (order.offer_id) {
        const { data: offerData } = await supabase
          .from('tariff_offers')
          .select('meta')
          .eq('id', order.offer_id)
          .maybeSingle();
        
        if (offerData?.meta?.recurring) {
          recurringSnapshot = offerData.meta.recurring;
          console.log(`[grant-access-for-order] Saved recurring_snapshot from offer ${order.offer_id}`);
        }
      }
      
      // 2) Fallback with isLikelySubscription guard
      // Guard: at least one of these indicates this should be a subscription
      const isLikelySubscription = 
        order.offer_id != null ||
        tariffId != null ||
        hasPaymentMethod ||
        isClubProduct; // Club product is always subscription
      
      if (!recurringSnapshot && isLikelySubscription) {
        recurringSnapshot = DEFAULT_RECURRING_SNAPSHOT;
        console.log(`[grant-access-for-order] Using fallback recurring_snapshot for order ${orderId}`);
        
        // SYSTEM ACTOR Proof: log fallback usage
        await supabase.from('audit_logs').insert({
          action: 'subscription.recurring_snapshot_fallback_used',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'grant-access-for-order',
          target_user_id: userId,
          meta: { 
            order_id: orderId, 
            reason: 'missing_offer_or_recurring',
            guards: { offer_id: !!order.offer_id, tariff_id: !!tariffId, has_payment_method: hasPaymentMethod, is_club: isClubProduct }
          },
        });
      } else if (!recurringSnapshot && !isLikelySubscription) {
        console.log(`[grant-access-for-order] No recurring_snapshot and not likely subscription for order ${orderId}`);
        // Log missing snapshot for non-subscription orders (for diagnostics)
        await supabase.from('audit_logs').insert({
          action: 'subscription.recurring_snapshot_missing',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'grant-access-for-order',
          target_user_id: userId,
          meta: { 
            order_id: orderId, 
            reason: 'not_likely_subscription',
            guards: { offer_id: !!order.offer_id, tariff_id: !!tariffId, has_payment_method: hasPaymentMethod, is_club: isClubProduct }
          },
        });
      }

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

    // 3b. Process product_access rules — grant access to additional products
    try {
      let productAccessRules: any[] = [];

      // Tariff-level rules first (higher precedence)
      if (tariffId) {
        const { data: tariffRules } = await supabase
          .from("access_rules")
          .select("id, target_ref, conditions, priority, duration_days")
          .eq("tariff_id", tariffId)
          .eq("grant_target_type", "product_access")
          .eq("is_active", true)
          .order("priority", { ascending: false });
        if (tariffRules?.length) productAccessRules = tariffRules;
      }

      // Product-level rules (fallback if no tariff rules)
      if (productAccessRules.length === 0 && productId) {
        const { data: prodRules } = await supabase
          .from("access_rules")
          .select("id, target_ref, conditions, priority, duration_days")
          .eq("product_id", productId)
          .is("tariff_id", null)
          .eq("grant_target_type", "product_access")
          .eq("is_active", true)
          .order("priority", { ascending: false });
        if (prodRules?.length) productAccessRules = prodRules;
      }

      if (productAccessRules.length > 0) {
        console.log(`[grant-access] Found ${productAccessRules.length} product_access rules`);
        const productAccessResults: any[] = [];

        for (const rule of productAccessRules) {
          const ruleConditions = rule.conditions || {};
          
          // Resolve target product IDs: multi-product (new) or single (legacy)
          const targetProductIds: string[] = Array.isArray(ruleConditions.target_product_ids)
            ? ruleConditions.target_product_ids
            : (rule.target_ref ? [rule.target_ref] : []);

          if (targetProductIds.length === 0) continue;

          // Check if rule has prior_purchase condition
          const hasPriorPurchaseCondition = ruleConditions.condition_type === 'prior_purchase';

          // Resolve condition product IDs for per-product filtering
          let conditionProductIds: string[] = [];
          if (hasPriorPurchaseCondition) {
            conditionProductIds = Array.isArray(ruleConditions.required_product_ids)
              ? ruleConditions.required_product_ids
              : (ruleConditions.required_product_id ? [ruleConditions.required_product_id] : []);
            
            // If match_mode is per_product and no explicit condition list, use target list
            if (conditionProductIds.length === 0 && ruleConditions.match_mode === 'per_product') {
              conditionProductIds = targetProductIds;
            }
          }

          // Process each target product
          for (const targetProdId of targetProductIds) {
            const eventKey = `gafo:product_access:${orderId}:${rule.id}:${targetProdId}`;
            
            // Per-product prior purchase check
            if (hasPriorPurchaseCondition) {
              // Check if this specific target product was previously purchased
              const productToCheck = conditionProductIds.includes(targetProdId) 
                ? targetProdId 
                : null;

              if (productToCheck) {
                // Use canonical shared resolver (direct match + module_list_mapped fallback)
                const priorResult = await checkPriorPurchase(supabase, userId, productToCheck, orderId);

                if (!priorResult.found) {
                  console.log(`[grant-access] product_access: target ${targetProdId} SKIPPED (no prior purchase, checked direct + module_list_mapped)`);
                  try {
                    await writeLedgerEntry(supabase, {
                      source_event_type: 'webhook',
                      source_event_key: eventKey,
                      source_subject_type: 'order',
                      source_subject_ref: orderId,
                      source_order_id: orderId,
                      action_type: 'grant',
                      reason_code: 'no_matching_target',
                      target_type: 'product',
                      target_key: `${userId}:${targetProdId}`,
                      user_id: userId,
                      profile_id: profileId || null,
                      order_id: orderId,
                      status: 'skipped',
                      result: {
                        rule_id: rule.id,
                        condition_type: 'prior_purchase',
                        target_product_id: targetProdId,
                        check_result: false,
                      },
                    });
                  } catch (ledgerErr) {
                    console.error('[grant-access] Ledger write for product_access skip failed:', ledgerErr);
                  }
                  productAccessResults.push({ target_product_id: targetProdId, status: 'skipped', reason: 'condition_not_met' });
                  continue;
                }
                
                console.log(`[grant-access] product_access: target ${targetProdId} prior purchase FOUND via ${priorResult.match_type} (order: ${priorResult.order_id})`);
              } else {
                // Target product not in condition list — skip
                console.log(`[grant-access] product_access: target ${targetProdId} SKIPPED (not in condition product list)`);
                productAccessResults.push({ target_product_id: targetProdId, status: 'skipped', reason: 'not_in_condition_list' });
                continue;
              }
            }

            // Grant: write entitlement for this target product
            console.log(`[grant-access] product_access: GRANTING access to product ${targetProdId}`);
            try {
              // Look up target product code
              const { data: targetProduct } = await supabase
                .from('products_v2')
                .select('code')
                .eq('id', targetProdId)
                .maybeSingle();

              const targetProductCode = targetProduct?.code || targetProdId;

              // Phase C: align_with_source — if rule.duration_days is null, 
              // align expires_at with the source subscription's access_end_at
              let paExpiresAt: string | null = null;
              let sourceWindowRule = 'default';

              if (rule.duration_days) {
                paExpiresAt = new Date(Date.now() + rule.duration_days * 86400000).toISOString();
                sourceWindowRule = 'rule_duration';
              } else {
                // align_with_source: use the triggering subscription's access_end_at
                // Canonical SoT: MAX(access_end_at) from active OR past_due subscriptions
                const { data: sourceSub } = await supabase
                  .from('subscriptions_v2')
                  .select('id, access_end_at, tariff_id')
                  .eq('user_id', userId)
                  .eq('product_id', productId)
                  .in('status', ['active', 'past_due'])
                  .order('access_end_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                
                if (sourceSub?.access_end_at) {
                  paExpiresAt = sourceSub.access_end_at;
                  sourceWindowRule = 'align_with_source';
                  console.log(`[grant-access] product_access: align_with_source expires_at=${paExpiresAt} from sub ${sourceSub.id} (canonical SoT: MAX active+past_due)`);
                } else {
                  console.warn(`[grant-access] product_access: no active/past_due source subscription for align_with_source, expires_at=null`);
                }
              }

              // Phase C: Build enriched meta with mandatory traceability fields
              // Determine historical purchase type from prior order
              let historicalPurchaseType = 'unknown';
              let historicalTariffId: string | null = null;
              let historicalModuleProductIds: string[] = [];
              let scopeResolutionMode = 'full_tariff_scope';

              // Prefer orders with tariff_id (full product purchase) over module-only orders
              const { data: priorOrdersList } = await supabase
                .from('orders_v2')
                .select('id, tariff_id, purchase_snapshot')
                .eq('user_id', userId)
                .eq('product_id', targetProdId)
                .eq('status', 'paid')
                .neq('id', orderId)
                .order('tariff_id', { ascending: false, nullsFirst: false })
                .limit(5);

              const priorOrderData = (priorOrdersList || []).find(o => o.tariff_id) || (priorOrdersList || [])[0] || null;

              if (priorOrderData) {
                const snapshot = (priorOrderData.purchase_snapshot || {}) as Record<string, any>;
                historicalPurchaseType = snapshot.historical_purchase_type || 
                  (priorOrderData.tariff_id ? 'base_tariff_purchase' : 'module_only_standalone');
                historicalTariffId = priorOrderData.tariff_id || snapshot.tariff_id || null;
                
                if (Array.isArray(snapshot.module_list_mapped)) {
                  historicalModuleProductIds = snapshot.module_list_mapped;
                }

                // Variant B scope resolution
                if (historicalPurchaseType === 'module_only_standalone' || historicalPurchaseType === 'module_child_purchase') {
                  scopeResolutionMode = historicalModuleProductIds.length > 0 ? 'module_scope_only' : 'manual_review';
                } else if (priorOrderData.tariff_id) {
                  scopeResolutionMode = 'full_tariff_scope';
                }
              } else {
                scopeResolutionMode = 'no_scope';
              }

              // Get source business subscription info (canonical SoT: active+past_due, MAX access_end_at)
              const { data: businessSub } = await supabase
                .from('subscriptions_v2')
                .select('id, tariff_id, access_end_at')
                .eq('user_id', userId)
                .eq('product_id', productId)
                .in('status', ['active', 'past_due'])
                .order('access_end_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              const enrichedMeta = {
                granted_by: "rule_engine_product_access",
                source_rule_id: rule.id,
                source_order_id: orderId,
                business_subscription_id: businessSub?.id || null,
                business_tariff_id: businessSub?.tariff_id || tariffId || null,
                source_access_end_at: businessSub?.access_end_at || null,
                historical_purchase_type: historicalPurchaseType,
                historical_tariff_id: historicalTariffId,
                historical_module_product_ids: historicalModuleProductIds,
                scope_resolution_mode: scopeResolutionMode,
                source_window_rule: sourceWindowRule,
              };

              // Check existing entitlement first (GREATEST logic - never decrease)
              // PATCH: lookup by product_id (ID-first), not product_code
              const { data: existingPaEnt } = await supabase
                .from('entitlements')
                .select('id, expires_at, order_id, meta')
                .eq('user_id', userId)
                .eq('product_id', targetProdId)
                .maybeSingle();

              let paEntAction = 'created';
              let paEntError: any = null;

              if (existingPaEnt) {
                // Update existing — GREATEST logic, preserve original order_id
                const newExpiry = paExpiresAt 
                  ? (existingPaEnt.expires_at && new Date(existingPaEnt.expires_at) > new Date(paExpiresAt) 
                      ? existingPaEnt.expires_at 
                      : paExpiresAt)
                  : existingPaEnt.expires_at; // null (unlimited) from rule means keep current

                // Merge existing meta with enriched meta (enriched takes precedence)
                const existingMeta = (existingPaEnt.meta || {}) as Record<string, any>;
                const mergedMeta = { ...existingMeta, ...enrichedMeta };

                const { error } = await supabase
                  .from('entitlements')
                  .update({
                    status: 'active',
                    expires_at: newExpiry,
                    meta: mergedMeta,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingPaEnt.id);
                paEntError = error;
                paEntAction = 'updated';
              } else {
                // Create new entitlement — no order_id to avoid unique constraint
                const { error } = await supabase
                  .from('entitlements')
                  .insert({
                    user_id: userId,
                    product_code: targetProductCode,
                    product_id: targetProdId,
                    profile_id: profileId || null,
                    status: 'active',
                    expires_at: paExpiresAt,
                    meta: enrichedMeta,
                  });
                paEntError = error;
              }

              if (paEntError) {
                console.error(`[grant-access] Entitlement ${paEntAction} failed for ${targetProdId}:`, paEntError);
                productAccessResults.push({ target_product_id: targetProdId, status: 'failed', error: paEntError.message });
              } else {
                // Ledger: granted
                try {
                  await writeLedgerEntry(supabase, {
                    source_event_type: 'webhook',
                    source_event_key: eventKey,
                    source_subject_type: 'order',
                    source_subject_ref: orderId,
                    source_order_id: orderId,
                    action_type: 'grant',
                    reason_code: 'rule_engine_bonus',
                    target_type: 'product',
                    target_key: `${userId}:${targetProdId}`,
                    user_id: userId,
                    profile_id: profileId || null,
                    order_id: orderId,
                    status: 'granted',
                    result: {
                      rule_id: rule.id,
                      target_product_id: targetProdId,
                      product_code: targetProductCode,
                      expires_at: paExpiresAt,
                      entitlement_action: paEntAction,
                    },
                  });
                } catch (ledgerErr) {
                  console.error('[grant-access] Ledger write for product_access grant failed:', ledgerErr);
                }
                productAccessResults.push({ target_product_id: targetProdId, status: 'granted', product_code: targetProductCode, entitlement_action: paEntAction });
              }
            } catch (grantErr) {
              console.error(`[grant-access] product_access grant error for ${targetProdId}:`, grantErr);
              productAccessResults.push({ target_product_id: targetProdId, status: 'failed', error: String(grantErr) });
            }
          }
        }

        results.product_access = productAccessResults;
      }
    } catch (productAccessError) {
      console.error("Product access rules error (non-critical):", productAccessError);
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
