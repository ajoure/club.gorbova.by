import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { secretKey } = await req.json();
    
    if (secretKey !== "test-flow-2024") {
      return new Response(JSON.stringify({ error: "Invalid secret key" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // User IDs from database - auth.users.id is different from profiles.id
    const authUserId = "05cd3754-d589-4d90-97d1-89ba2bee610b"; // auth.users.id
    const profileId = "a4b7c8c9-8210-499e-ae3f-2a5db2121577";  // profiles.id
    const productId = "11c9f1b8-0355-4753-bd74-40b42aa53616";
    const tariffId = "b276d8a5-8e5f-4876-9f99-36f818722d6c";
    const trialOfferId = "220f923b-c69d-4e86-a8a7-f715a5ca1fdc";
    const fullPaymentOfferId = "c5781abf-0376-4e1f-91dc-99773906ee77";
    
    const results: Record<string, unknown> = {};
    const now = new Date();
    
    // Dates for simulation
    const trialStartDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const trialEndDate = now; // Trial ends now
    const accessEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    // Get product and tariff info
    const { data: product } = await supabase
      .from("products_v2")
      .select("name, code, telegram_club_id")
      .eq("id", productId)
      .single();

    const { data: tariff } = await supabase
      .from("tariffs")
      .select("name, trial_price, price, trial_days, access_days, meta")
      .eq("id", tariffId)
      .single();

    const { data: trialOffer } = await supabase
      .from("tariff_offers")
      .select("id, button_label, amount, meta, getcourse_offer_id, offer_type")
      .eq("id", trialOfferId)
      .single();

    const { data: fullOffer } = await supabase
      .from("tariff_offers")
      .select("id, button_label, amount, meta, getcourse_offer_id, offer_type")
      .eq("id", fullPaymentOfferId)
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, telegram_user_id")
      .eq("id", profileId)
      .single();

    results.product = product;
    results.tariff = tariff;
    results.trialOffer = trialOffer;
    results.fullOffer = fullOffer;
    results.profile = profile;
    
    // Log tariff info for debugging
    console.log("Tariff data:", tariff);
    console.log("Trial offer:", trialOffer);
    console.log("Full offer:", fullOffer);

    // Generate order number
    const orderNumber = `SIM-TRIAL-${Date.now()}`;

    // ========== STEP 0: Cleanup previous simulation data ==========
    console.log("Step 0: Cleaning up previous simulation data...");
    
    // Get simulation orders for this user/product/tariff
    const { data: simOrders } = await supabase
      .from("orders_v2")
      .select("id")
      .eq("profile_id", profileId)
      .eq("product_id", productId)
      .eq("tariff_id", tariffId)
      .eq("meta->simulation", true);
    
    const simOrderIds = simOrders?.map(o => o.id) || [];
    
    if (simOrderIds.length > 0) {
      // Delete entitlements for simulation orders
      await supabase
        .from("entitlements")
        .delete()
        .eq("user_id", authUserId)
        .eq("product_code", product?.code || "club");
      
      // Delete subscriptions for simulation orders
      await supabase
        .from("subscriptions_v2")
        .delete()
        .in("order_id", simOrderIds);
      
      // Delete payments for simulation orders
      await supabase
        .from("payments_v2")
        .delete()
        .in("order_id", simOrderIds);
      
      // Delete simulation orders
      await supabase
        .from("orders_v2")
        .delete()
        .in("id", simOrderIds);
      
      console.log(`Cleaned up ${simOrderIds.length} simulation orders`);
    }
    
    results.cleanup = { deletedOrders: simOrderIds.length };

    // ========== STEP 1: Create Trial Order ==========
    console.log("Step 1: Creating trial order...");

    const { data: trialOrder, error: orderError } = await supabase
      .from("orders_v2")
      .insert({
        order_number: orderNumber,
        profile_id: profileId,
        user_id: authUserId,
        product_id: productId,
        tariff_id: tariffId,
        status: "paid",
        base_price: tariff?.trial_price || 1,
        final_price: tariff?.trial_price || 1,
        currency: "BYN",
        paid_amount: tariff?.trial_price || 1,
        is_trial: true,
        meta: {
          offer_id: trialOfferId,
          simulation: true,
          simulation_date: now.toISOString(),
          paid_at: trialStartDate.toISOString(),
        },
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order creation error:", orderError);
      throw new Error(`Failed to create order: ${orderError.message}`);
    }
    results.trialOrder = trialOrder;

    // ========== STEP 2: Create Trial Payment ==========
    console.log("Step 2: Creating trial payment...");

    const { data: trialPayment, error: paymentError } = await supabase
      .from("payments_v2")
      .insert({
        order_id: trialOrder.id,
        user_id: authUserId,
        profile_id: profileId,
        amount: tariff?.trial_price || 1,
        currency: "BYN",
        status: "succeeded",
        provider: "simulation",
        provider_payment_id: `SIM-PAY-TRIAL-${Date.now()}`,
        paid_at: trialStartDate.toISOString(),
        meta: {
          simulation: true,
          type: "trial",
        },
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Payment creation error:", paymentError);
      throw new Error(`Failed to create payment: ${paymentError.message}`);
    }
    results.trialPayment = trialPayment;

    // ========== STEP 3: Create Subscription ==========
    console.log("Step 3: Creating subscription...");

    const { data: subscription, error: subError } = await supabase
      .from("subscriptions_v2")
      .insert({
        order_id: trialOrder.id,
        profile_id: profileId,
        user_id: authUserId,
        product_id: productId,
        tariff_id: tariffId,
        status: "trial",
        is_trial: true,
        access_start_at: trialStartDate.toISOString(),
        access_end_at: trialEndDate.toISOString(),
        trial_end_at: trialEndDate.toISOString(),
        next_charge_at: trialEndDate.toISOString(),
        payment_token: `TEST-TOKEN-${Date.now()}`,
        meta: {
          simulation: true,
          offer_id: trialOfferId,
        },
      })
      .select()
      .single();

    if (subError) {
      console.error("Subscription creation error:", subError);
      throw new Error(`Failed to create subscription: ${subError.message}`);
    }
    results.subscription = subscription;

    // ========== STEP 4: Create Entitlement ==========
    console.log("Step 4: Creating entitlement...");

    const { data: entitlement, error: entError } = await supabase
      .from("entitlements")
      .insert({
        user_id: authUserId,
        profile_id: profileId,
        product_code: product?.code || "gorbova-club",
        order_id: trialOrder.id,
        status: "active",
        expires_at: accessEndDate.toISOString(),
        meta: {
          simulation: true,
          subscription_id: subscription.id,
        },
      })
      .select()
      .single();

    if (entError) {
      console.error("Entitlement creation error:", entError);
      throw new Error(`Failed to create entitlement: ${entError.message}`);
    }
    results.entitlement = entitlement;

    // ========== STEP 5: Grant Telegram Access ==========
    console.log("Step 5: Granting Telegram access...");

    try {
      const telegramGrantResponse = await fetch(
        `${supabaseUrl}/functions/v1/telegram-grant-access`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            user_id: authUserId,
            source: "payment",
            source_id: trialOrder.id,
            valid_until: accessEndDate.toISOString(),
          }),
        }
      );

      const telegramGrantResult = await telegramGrantResponse.json();
      results.telegramGrant = telegramGrantResult;
      console.log("Telegram grant result:", telegramGrantResult);
    } catch (tgError) {
      console.error("Telegram grant error:", tgError);
      results.telegramGrantError = String(tgError);
    }

    // ========== STEP 5.5: Sync Trial to GetCourse ==========
    console.log("Step 5.5: Syncing trial order to GetCourse...");

    try {
      // Find GetCourse integration instance
      const { data: gcInstance } = await supabase
        .from("integration_instances")
        .select("id")
        .eq("provider", "getcourse")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (gcInstance && trialOffer?.getcourse_offer_id) {
        const gcSyncResponse = await fetch(
          `${supabaseUrl}/functions/v1/getcourse-sync`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              instance_id: gcInstance.id,
              action: "add_user_to_offer",
              user_id: authUserId,
              offer_code: trialOffer.getcourse_offer_id,
            }),
          }
        );
        const gcSyncResult = await gcSyncResponse.json();
        results.gcSyncTrial = gcSyncResult;
        console.log("GC trial sync result:", gcSyncResult);
      } else {
        results.gcSyncTrial = { skipped: true, reason: "No GC instance or offer code" };
      }
    } catch (gcError) {
      console.error("GC sync trial error:", gcError);
      results.gcSyncTrialError = String(gcError);
    }

    // ========== STEP 6: Notify Admins about Trial Purchase ==========
    console.log("Step 6: Notifying admins about trial purchase...");

    try {
      const adminNotifyResponse = await fetch(
        `${supabaseUrl}/functions/v1/telegram-notify-admins`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `🆕 <b>Новый заказ (триал)</b>\n\n` +
              `📦 ${product?.name || "—"}\n` +
              `🏷 Тариф: ${tariff?.name || "—"}\n` +
              `🎁 Предложение: ${trialOffer?.button_label || "—"}\n` +
              `👤 ${profile?.full_name || "—"}\n` +
              `📧 ${profile?.email || "—"}\n` +
              `💰 ${tariff?.trial_price || 1} BYN\n` +
              `🔢 №${orderNumber}\n` +
              `🧪 <i>Симуляция</i>`,
            parse_mode: "HTML",
          }),
        }
      );

      const adminNotifyResult = await adminNotifyResponse.json();
      results.adminNotifyTrial = adminNotifyResult;
    } catch (notifyError) {
      console.error("Admin notify error:", notifyError);
      results.adminNotifyTrialError = String(notifyError);
    }

    // ========== STEP 7: Simulate 5 days passing - Full Payment ==========
    console.log("Step 7: Simulating full payment after trial...");

    // Create full payment
    const { data: fullPayment, error: fullPayError } = await supabase
      .from("payments_v2")
      .insert({
        order_id: trialOrder.id,
        user_id: authUserId,
        profile_id: profileId,
        amount: tariff?.price || 150,
        currency: "BYN",
        status: "succeeded",
        provider: "simulation",
        provider_payment_id: `SIM-PAY-FULL-${Date.now()}`,
        paid_at: now.toISOString(),
        meta: {
          simulation: true,
          type: "full_after_trial",
          offer_id: fullPaymentOfferId,
        },
      })
      .select()
      .single();

    if (fullPayError) {
      console.error("Full payment creation error:", fullPayError);
      throw new Error(`Failed to create full payment: ${fullPayError.message}`);
    }
    results.fullPayment = fullPayment;

    // ========== STEP 8: Update Subscription to Active ==========
    console.log("Step 8: Updating subscription to active...");

    const { data: updatedSubscription, error: updateSubError } = await supabase
      .from("subscriptions_v2")
      .update({
        status: "active",
        is_trial: false,
        access_end_at: accessEndDate.toISOString(),
        next_charge_at: null,
        meta: {
          ...((subscription.meta as Record<string, unknown>) || {}),
          converted_from_trial: true,
          converted_at: now.toISOString(),
          full_payment_id: fullPayment.id,
        },
      })
      .eq("id", subscription.id)
      .select()
      .single();

    if (updateSubError) {
      console.error("Subscription update error:", updateSubError);
    }
    results.updatedSubscription = updatedSubscription;

    // ========== STEP 9: Update Order with Full Payment Info ==========
    console.log("Step 9: Updating order with full payment info...");

    const { error: updateOrderError } = await supabase
      .from("orders_v2")
      .update({
        paid_amount: (tariff?.trial_price || 1) + (tariff?.price || 150),
        meta: {
          ...((trialOrder.meta as Record<string, unknown>) || {}),
          full_payment_id: fullPayment.id,
          full_payment_at: now.toISOString(),
          full_offer_id: fullPaymentOfferId,
        },
      })
      .eq("id", trialOrder.id);

    if (updateOrderError) {
      console.error("Order update error:", updateOrderError);
    }
    results.orderUpdated = !updateOrderError;

    // ========== STEP 9.5: Sync Full Payment to GetCourse ==========
    console.log("Step 9.5: Syncing full payment to GetCourse...");

    try {
      const { data: gcInstance } = await supabase
        .from("integration_instances")
        .select("id")
        .eq("provider", "getcourse")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (gcInstance && fullOffer?.getcourse_offer_id) {
        const gcSyncResponse = await fetch(
          `${supabaseUrl}/functions/v1/getcourse-sync`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              instance_id: gcInstance.id,
              action: "add_user_to_offer",
              user_id: authUserId,
              offer_code: fullOffer.getcourse_offer_id,
            }),
          }
        );
        const gcSyncResult = await gcSyncResponse.json();
        results.gcSyncFull = gcSyncResult;
        console.log("GC full sync result:", gcSyncResult);
      } else {
        results.gcSyncFull = { skipped: true, reason: "No GC instance or offer code" };
      }
    } catch (gcError) {
      console.error("GC sync full error:", gcError);
      results.gcSyncFullError = String(gcError);
    }

    // ========== STEP 9.6: Send Full Offer Welcome Message ==========
    console.log("Step 9.6: Sending full offer welcome message...");

    if (profile?.telegram_user_id && fullOffer?.meta) {
      try {
        const { data: botData } = await supabase
          .from("telegram_bots")
          .select("bot_token_encrypted")
          .eq("status", "active")
          .eq("is_primary", true)
          .limit(1)
          .maybeSingle();

        if (botData?.bot_token_encrypted) {
          const botToken = botData.bot_token_encrypted;
          const fullOfferMeta = fullOffer.meta as Record<string, unknown>;
          const fullOfferWelcome = fullOfferMeta?.welcome_message as {
            enabled?: boolean;
            text?: string;
            button?: { enabled?: boolean; text?: string; url?: string };
            media?: { type?: string; storage_path?: string };
          } | undefined;

          if (fullOfferWelcome?.enabled) {
            // Send media if present
            if (fullOfferWelcome.media?.type && fullOfferWelcome.media?.storage_path) {
              const { data: mediaData } = await supabase.storage
                .from("telegram-media")
                .download(fullOfferWelcome.media.storage_path);
              
              if (mediaData) {
                const formData = new FormData();
                formData.append("chat_id", String(profile.telegram_user_id));
                formData.append(fullOfferWelcome.media.type === "video" ? "video" : "photo", mediaData, "media");
                
                await fetch(`https://api.telegram.org/bot${botToken}/send${fullOfferWelcome.media.type === "video" ? "Video" : "Photo"}`, {
                  method: "POST",
                  body: formData,
                });
              }
            }

            // Send text with button
            if (fullOfferWelcome.text) {
              const keyboard = fullOfferWelcome.button?.enabled && fullOfferWelcome.button.url ? {
                inline_keyboard: [[{
                  text: fullOfferWelcome.button.text || "Открыть",
                  url: fullOfferWelcome.button.url,
                }]]
              } : undefined;

              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: profile.telegram_user_id,
                  text: fullOfferWelcome.text,
                  parse_mode: "HTML",
                  reply_markup: keyboard,
                }),
              });
              console.log("Sent full offer welcome message");
            }
            results.fullOfferWelcome = { sent: true };
          } else {
            results.fullOfferWelcome = { skipped: true, reason: "Welcome not enabled" };
          }
        }
      } catch (welcomeError) {
        console.error("Full offer welcome error:", welcomeError);
        results.fullOfferWelcomeError = String(welcomeError);
      }
    }

    // ========== STEP 10: Send Telegram Notification about Renewal ==========
    console.log("Step 10: Sending Telegram notification about renewal...");

    if (profile?.telegram_user_id) {
      try {
        const { data: botData } = await supabase
          .from("telegram_bots")
          .select("bot_token_encrypted")
          .eq("status", "active")
          .eq("is_primary", true)
          .limit(1)
          .maybeSingle();
        
        if (botData?.bot_token_encrypted) {
          const botToken = botData.bot_token_encrypted;
          const message = `🎉 Поздравляем! Ваша подписка на "${product?.name || "—"}" (тариф "${tariff?.name || "—"}") успешно продлена!\n\n💳 Оплачено: ${tariff?.price || 150} BYN\n📅 Доступ до: ${accessEndDate.toLocaleDateString("ru-RU")}\n\nСпасибо, что вы с нами! 💜\n\n🧪 <i>Это тестовое сообщение</i>`;
          
          const tgResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: profile.telegram_user_id,
                text: message,
                parse_mode: "HTML",
              }),
            }
          );
          
          const tgResult = await tgResponse.json();
          results.renewalNotification = tgResult;
          console.log("Renewal notification result:", tgResult);
        } else {
          results.renewalNotificationError = "No active primary bot found";
        }
      } catch (notifError) {
        console.error("Renewal notification error:", notifError);
        results.renewalNotificationError = String(notifError);
      }
    }

    // ========== STEP 11: Notify Admins about Full Payment ==========
    console.log("Step 11: Notifying admins about full payment...");

    try {
      const adminNotifyFullResponse = await fetch(
        `${supabaseUrl}/functions/v1/telegram-notify-admins`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `💳 <b>Триал → Оплата</b>\n\n` +
              `📦 ${product?.name || "—"}\n` +
              `🏷 Тариф: ${tariff?.name || "—"}\n` +
              `🎁 Предложение: ${fullOffer?.button_label || "—"}\n` +
              `👤 ${profile?.full_name || "—"}\n` +
              `📧 ${profile?.email || "—"}\n` +
              `💰 ${tariff?.price || 150} BYN\n` +
              `🔢 №${orderNumber}\n` +
              `🧪 <i>Симуляция</i>`,
            parse_mode: "HTML",
          }),
        }
      );

      const adminNotifyFullResult = await adminNotifyFullResponse.json();
      results.adminNotifyFull = adminNotifyFullResult;
    } catch (notifyError) {
      console.error("Admin notify full error:", notifyError);
      results.adminNotifyFullError = String(notifyError);
    }

    // ========== STEP 12: Send Renewal Email ==========
    console.log("Step 12: Sending renewal email...");

    try {
      const emailResponse = await fetch(
        `${supabaseUrl}/functions/v1/send-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            to: profile?.email,
            subject: `Подписка продлена: ${product?.name}`,
            html: `
              <h2>Ваша подписка успешно продлена! 🎉</h2>
              <p>Здравствуйте, ${profile?.full_name}!</p>
              <p>Ваша подписка на <strong>${product?.name}</strong> (тариф "${tariff?.name}") была успешно оплачена и продлена.</p>
              <p><strong>Сумма:</strong> ${tariff?.price || 150} BYN</p>
              <p><strong>Доступ до:</strong> ${accessEndDate.toLocaleDateString("ru-RU")}</p>
              <p>Спасибо, что вы с нами!</p>
              <p>С уважением,<br>Команда Gorbova Club</p>
            `,
            templateCode: "subscription_renewed",
            profileId: profileId,
          }),
        }
      );

      const emailResult = await emailResponse.json();
      results.renewalEmail = emailResult;
    } catch (emailError) {
      console.error("Email error:", emailError);
      results.renewalEmailError = String(emailError);
    }

    console.log("Simulation completed successfully!");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Full trial flow simulation completed",
        summary: {
          user: profile?.email,
          product: product?.name,
          tariff: tariff?.name,
          trialPayment: `${tariff?.trial_price || 1} BYN`,
          fullPayment: `${tariff?.price || 150} BYN`,
          totalPaid: `${(tariff?.trial_price || 1) + (tariff?.price || 150)} BYN`,
          accessUntil: accessEndDate.toISOString(),
          orderId: trialOrder.id,
          subscriptionId: subscription.id,
        },
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Simulation error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
