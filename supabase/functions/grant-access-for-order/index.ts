import { createClient } from "npm:@supabase/supabase-js@2";
import { isCalendarMonthProduct, calcCalendarMonthEnd } from '../_shared/resolve-access-window.ts';
import { writeLedgerEntry, buildPostCheck } from '../_shared/fulfillment-executor.ts';

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
        // Extend from end of current access
        accessStartAt = new Date(activeSub.access_end_at);
        existingProductSub = activeSub;
        console.log(`Extending from existing access end: ${activeSub.access_end_at}`);
      }
    }
    
    // Phase 1: Calculate access_end_at - calendar month from config, days for others
    let accessEndAt: Date;
    if (isClubProduct && !customAccessDays) {
      accessEndAt = calcCalendarMonthEnd(accessStartAt);
      console.log(`[grant-access-for-order] Calendar month product: ${accessStartAt.toISOString()} → ${accessEndAt.toISOString()}`);
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

    // 1. Upsert entitlement
    const { data: existingEntitlement } = await supabase
      .from("entitlements")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("product_code", productCode)
      .maybeSingle();

    if (existingEntitlement) {
      // Update existing entitlement - extend if current expires_at is later than accessEndAt
      const newExpiresAt = existingEntitlement.expires_at && 
        new Date(existingEntitlement.expires_at) > accessEndAt
          ? existingEntitlement.expires_at
          : accessEndAt.toISOString();
          
      const { error: updateError } = await supabase
        .from("entitlements")
        .update({
          status: "active",
          expires_at: newExpiresAt,
          order_id: orderId,
          updated_at: now.toISOString(),
        })
        .eq("id", existingEntitlement.id);

      if (updateError) {
        console.error("Error updating entitlement:", updateError);
      } else {
        results.entitlement = { action: "updated", id: existingEntitlement.id };
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
            granted_by: "grant-access-for-order",
            granted_at: now.toISOString(),
          },
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Error creating entitlement:", insertError);
      } else {
        results.entitlement = { action: "created", id: newEntitlement?.id };
      }
    }

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
    console.log(`User ${userId} payment method: ${userPaymentMethod?.id || 'none'}, auto_renew will be: ${hasPaymentMethod}`);

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

      // Attach payment method if not present
      if (!fullExistingSub?.payment_method_id && hasPaymentMethod) {
        updateData.payment_method_id = userPaymentMethod.id;
        updateData.auto_renew = true;
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
          access_end_at: accessEndAt.toISOString(),
          next_charge_at: accessEndAt.toISOString(),
          payment_method_id: hasPaymentMethod ? userPaymentMethod.id : null,
          auto_renew: true,
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
        results.subscription = { action: "created", id: newSub?.id, auto_renew: true };
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
                reason_code: 'condition_not_met',
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

        // Legacy fallback: product_club_mappings
        if (!clubId) {
          const { data: clubMapping } = await supabase
            .from("product_club_mappings")
            .select("club_id")
            .eq("product_id", productId)
            .maybeSingle();
          if (clubMapping?.club_id) {
            clubId = clubMapping.club_id;
            console.log(`[grant-access] Club from legacy product_club_mappings: ${clubId}`);
          }
        }

        if (clubId) {
          const telegramResponse = await fetch(`${supabaseUrl}/functions/v1/telegram-grant-access`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              userId,
              clubId,
              orderId,
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
                const { data: priorOrder } = await supabase
                  .from('orders_v2')
                  .select('id')
                  .eq('user_id', userId)
                  .eq('product_id', productToCheck)
                  .eq('status', 'paid')
                  .neq('id', orderId) // Exclude current order
                  .limit(1)
                  .maybeSingle();

                if (!priorOrder) {
                  console.log(`[grant-access] product_access: target ${targetProdId} SKIPPED (no prior purchase)`);
                  try {
                    await writeLedgerEntry(supabase, {
                      source_event_type: 'webhook',
                      source_event_key: eventKey,
                      source_subject_type: 'order',
                      source_subject_ref: orderId,
                      source_order_id: orderId,
                      action_type: 'grant',
                      reason_code: 'condition_not_met',
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

              // Calculate expires_at for this rule
              const paExpiresAt = rule.duration_days
                ? new Date(Date.now() + rule.duration_days * 86400000).toISOString()
                : null;

              // Check existing entitlement first (GREATEST logic - never decrease)
              const { data: existingPaEnt } = await supabase
                .from('entitlements')
                .select('id, expires_at, order_id')
                .eq('user_id', userId)
                .eq('product_code', targetProductCode)
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

                const { error } = await supabase
                  .from('entitlements')
                  .update({
                    status: 'active',
                    expires_at: newExpiry,
                    // Do NOT overwrite order_id — keep original purchase order
                    meta: { source_rule_id: rule.id, source_order_id: orderId },
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
                    // order_id intentionally omitted — this is a derived grant, not a direct purchase
                    status: 'active',
                    expires_at: paExpiresAt,
                    meta: { source_rule_id: rule.id, source_order_id: orderId },
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
                    reason_code: 'product_access_rule',
                    target_type: 'product_access',
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
