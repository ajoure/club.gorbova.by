import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PATCH: Staff emails - NEVER modify subscriptions for these users
const STAFF_EMAILS = [
  'a.bruylo@ajoure.by',
  'nrokhmistrov@gmail.com',
  'ceo@ajoure.by',
  'irenessa@yandex.ru',
];

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
    // PATCH-3: For club products, use calendar month (+1 month) instead of fixed days
    const now = new Date();
    const isClubProduct = productId === "11c9f1b8-0355-4753-bd74-40b42aa53616";
    const durationDays = customAccessDays ?? tariff?.access_days ?? 30;
    
    // Check for existing active subscription for this product to extend from
    let accessStartAt = now;
    let existingProductSub = null;
    
    if (extendFromCurrent) {
      const { data: activeSub } = await supabase
        .from("subscriptions_v2")
        .select("id, access_end_at, status, tariff_id")
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
    
    // PATCH-3: Calculate access_end_at - calendar month for club, days for others
    let accessEndAt: Date;
    if (isClubProduct && !customAccessDays) {
      // Calendar month: 22.01 → 22.02 → 22.03 (TZ-safe using UTC)
      accessEndAt = new Date(Date.UTC(
        accessStartAt.getUTCFullYear(),
        accessStartAt.getUTCMonth() + 1,  // +1 calendar month
        accessStartAt.getUTCDate(),
        12, 0, 0  // Normalize to noon UTC to avoid DST issues
      ));
      
      // Handle edge case: 31 Jan → 28/29 Feb (clamp to last day of month)
      if (accessEndAt.getUTCDate() !== accessStartAt.getUTCDate()) {
        accessEndAt = new Date(Date.UTC(
          accessStartAt.getUTCFullYear(),
          accessStartAt.getUTCMonth() + 2,
          0,  // Last day of previous month
          12, 0, 0
        ));
      }
      console.log(`[grant-access-for-order] Club product: calendar month ${accessStartAt.toISOString()} → ${accessEndAt.toISOString()}`);
    } else {
      // For non-club or custom days: use duration in days
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
      let recurringSnapshot = null;
      if (order.offer_id) {
        const { data: offerData } = await supabase
          .from('tariff_offers')
          .select('meta')
          .eq('id', order.offer_id)
          .maybeSingle();
        
        if (offerData?.meta?.recurring) {
          recurringSnapshot = offerData.meta.recurring;
          console.log(`Saved recurring_snapshot from offer ${order.offer_id}`);
        }
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
            recurring_amount: order.final_price,
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

    // 3. Try to grant Telegram access if applicable
    if (grantTelegram) {
      try {
        const { data: clubMapping } = await supabase
          .from("product_club_mappings")
          .select("club_id")
          .eq("product_id", productId)
          .maybeSingle();

        if (clubMapping?.club_id) {
          const telegramResponse = await fetch(`${supabaseUrl}/functions/v1/telegram-grant-access`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              userId,
              clubId: clubMapping.club_id,
              orderId,
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
