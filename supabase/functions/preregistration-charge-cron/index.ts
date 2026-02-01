import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function translatePaymentError(error: string): string {
  const errorMap: Record<string, string> = {
    "insufficient_funds": "Недостаточно средств на карте",
    "card_expired": "Срок действия карты истёк",
    "card_declined": "Карта отклонена банком",
    "invalid_card": "Недействительная карта",
    "processing_error": "Ошибка обработки платежа",
    "do_not_honor": "Операция отклонена банком",
    "transaction_not_permitted": "Операция не разрешена для этой карты",
    "suspected_fraud": "Подозрение на мошенничество",
    "withdrawal_limit_exceeded": "Превышен лимит снятия",
    "card_blocked": "Карта заблокирована",
    "lost_card": "Карта утеряна",
    "stolen_card": "Карта украдена",
    "timeout": "Время ожидания истекло",
  };

  for (const [key, translation] of Object.entries(errorMap)) {
    if (error?.toLowerCase().includes(key)) {
      return translation;
    }
  }
  return error || "Неизвестная ошибка";
}

async function sendPaymentSuccessNotification(
  supabase: any,
  userId: string,
  productName: string,
  amount: number,
  currency: string
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("telegram_user_id, telegram_link_status, full_name")
      .eq("user_id", userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== "active") {
      return;
    }

    const { data: linkBot } = await supabase
      .from("telegram_bots")
      .select("token")
      .eq("is_link_bot", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!linkBot?.token) return;

    const userName = profile.full_name || "Клиент";
    const message = `✅ *Платёж успешно проведён*

${userName}, спасибо за оплату!

📦 *Продукт:* ${productName}
💳 *Сумма:* ${amount} ${currency}

Доступ к материалам откроется 5 февраля 2026 года.

🔗 [Мои покупки](https://club.gorbova.by/purchases)`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    console.log(`Sent payment success notification to user ${userId} via Telegram`);
  } catch (err) {
    console.error("Failed to send payment success notification:", err);
  }
}

async function sendPaymentFailureNotification(
  supabase: any,
  userId: string,
  productName: string,
  amount: number,
  currency: string,
  errorMessage: string
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("telegram_user_id, telegram_link_status, full_name")
      .eq("user_id", userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== "active") {
      return;
    }

    const { data: linkBot } = await supabase
      .from("telegram_bots")
      .select("token")
      .eq("is_link_bot", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!linkBot?.token) return;

    const userName = profile.full_name || "Клиент";
    const russianError = translatePaymentError(errorMessage);

    const message = `❌ *Платёж не прошёл*

${userName}, к сожалению, не удалось провести оплату.

📦 *Продукт:* ${productName}
💳 *Сумма:* ${amount} ${currency}
⚠️ *Причина:* ${russianError}

*Что можно сделать:*
• Проверьте баланс карты
• Убедитесь, что карта не заблокирована
• Попробуйте оплатить другой картой

🔗 [Попробовать снова](https://business-training.gorbova.by)`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    console.log(`Sent payment failure notification to user ${userId} via Telegram`);
  } catch (err) {
    console.error("Failed to send payment failure notification:", err);
  }
}

async function sendAdminNotification(
  supabase: any,
  type: "success" | "failure",
  preregId: string,
  email: string,
  amount: number,
  currency: string,
  errorMessage?: string
): Promise<void> {
  try {
    const { data: admins } = await supabase
      .from("profiles")
      .select("telegram_user_id")
      .eq("telegram_link_status", "active")
      .in("user_id", 
        supabase.from("user_roles_v2")
          .select("user_id")
          .eq("role_id", 
            supabase.from("roles").select("id").eq("code", "super_admin").single()
          )
      );

    // Use notify-admins function instead
    await supabase.functions.invoke("telegram-notify-admins", {
      body: {
        message: type === "success"
          ? `✅ Автосписание предзаписи\n\nКлиент: ${email}\nСумма: ${amount} ${currency}\nID предзаписи: ${preregId}`
          : `❌ Ошибка автосписания предзаписи\n\nКлиент: ${email}\nСумма: ${amount} ${currency}\nПричина: ${errorMessage}\nID: ${preregId}`,
        priority: type === "failure" ? "high" : "normal",
      },
    });
  } catch (err) {
    console.error("Failed to send admin notification:", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const bepaidShopId = Deno.env.get("BEPAID_SHOP_ID") || "369258";
  const bepaidSecretKey = Deno.env.get("BEPAID_SECRET_KEY")!;
  const bepaidAuth = btoa(`${bepaidShopId}:${bepaidSecretKey}`);
  const testMode = Deno.env.get("BEPAID_TEST_MODE") === "true";

  const results = {
    processed: 0,
    charged: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    const now = new Date();
    
    // PATCH-1: Use Minsk timezone for charge window logic
    const minskFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Minsk',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric'
    });
    const minskDate = minskFormatter.format(now);
    const [month, day, year] = minskDate.split('/');
    const dayOfMonth = parseInt(day, 10);
    
    // Get date in YYYY-MM-DD format for first_charge_date comparison
    const todayMinsk = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Minsk'
    }).format(now);
    
    console.log(`Preregistration charge cron started at ${now.toISOString()}, todayMinsk: ${todayMinsk}, dayOfMonth: ${dayOfMonth}`);

    // 1. Find preregistrations that are ready for charging
    // Status: new or contacted, with user_id set (has account)
    const { data: preregistrations, error: preregError } = await supabase
      .from("course_preregistrations")
      .select(`
        id,
        user_id,
        email,
        name,
        phone,
        product_code,
        tariff_name,
        status,
        created_at
      `)
      .in("status", ["new", "contacted"])
      .not("user_id", "is", null);

    if (preregError) {
      throw new Error(`Failed to fetch preregistrations: ${preregError.message}`);
    }

    if (!preregistrations || preregistrations.length === 0) {
      console.log("No preregistrations found for charging");
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${preregistrations.length} preregistrations to check`);

    // 2. Get preregistration offer to check charge window
    const { data: preregOffer } = await supabase
      .from("tariff_offers")
      .select("id, meta, charge_offer_id")
      .eq("offer_type", "preregistration")
      .eq("is_active", true)
      .single();

    if (!preregOffer) {
      console.log("No active preregistration offer found");
      return new Response(JSON.stringify({ success: true, results, message: "No preregistration offer" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = preregOffer.meta as any || {};
    // PATCH-1: Fixed charge window logic - use day-of-month integers, not date strings
    const chargeWindowStart = meta.preregistration?.charge_window_start || meta.charge_window_start || 1;
    const chargeWindowEnd = meta.preregistration?.charge_window_end || meta.charge_window_end || 4;
    const firstChargeDate = meta.preregistration?.first_charge_date || meta.first_charge_date;
    const chargeOfferId = meta.charge_offer_id || preregOffer.charge_offer_id;

    // PATCH-1: Check first_charge_date (YYYY-MM-DD string comparison)
    if (firstChargeDate && todayMinsk < firstChargeDate) {
      console.log(`Today ${todayMinsk} is before first_charge_date ${firstChargeDate}`);
      return new Response(JSON.stringify({ 
        success: true, 
        results, 
        message: `Before first charge date (${firstChargeDate})` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH-1: Check if day of month is within charge window (1-4)
    if (dayOfMonth < chargeWindowStart || dayOfMonth > chargeWindowEnd) {
      console.log(`Day ${dayOfMonth} is outside charge window ${chargeWindowStart}-${chargeWindowEnd}`);
      return new Response(JSON.stringify({ 
        success: true, 
        results, 
        message: `Outside charge window (day ${dayOfMonth} not in ${chargeWindowStart}-${chargeWindowEnd})` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`Charge window check passed: day ${dayOfMonth} is within ${chargeWindowStart}-${chargeWindowEnd}`);

    // 3. Get the charge offer details (amount, product, tariff)
    if (!chargeOfferId) {
      throw new Error("No charge_offer_id configured for preregistration offer");
    }

    const { data: chargeOffer } = await supabase
      .from("tariff_offers")
      .select(`
        id,
        amount,
        tariff_id,
        is_recurring,
        tariffs!inner (
          id,
          name,
          product_id,
          products_v2!inner (
            id,
            name,
            code
          )
        )
      `)
      .eq("id", chargeOfferId)
      .single();

    if (!chargeOffer) {
      throw new Error(`Charge offer ${chargeOfferId} not found`);
    }

    const chargeAmount = Number(chargeOffer.amount);
    const currency = "BYN";
    const tariff = (chargeOffer as any).tariffs;
    const product = tariff?.products_v2;
    const productName = product?.name || "Бухгалтерия как бизнес";
    const productCode = product?.code || "buh_business";

    console.log(`Charge offer: ${chargeAmount} ${currency} for ${productName}`);

    // 4. Process each preregistration
    for (const prereg of preregistrations) {
      results.processed++;
      console.log(`Processing preregistration ${prereg.id} for ${prereg.email}`);

      try {
        // PATCH-2: Check if user already has a paid order for this product (prevent double charge)
        const { data: existingPaidOrder } = await supabase
          .from("orders_v2")
          .select("id, order_number")
          .eq("product_id", product.id)
          .eq("status", "paid")
          .or(`user_id.eq.${prereg.user_id},customer_email.ilike.${prereg.email}`)
          .limit(1)
          .maybeSingle();

        if (existingPaidOrder) {
          console.log(`Skipping ${prereg.id}: user already has paid order ${existingPaidOrder.order_number}`);
          
          // Auto-convert prereg to 'paid' status
          await supabase
            .from("course_preregistrations")
            .update({ status: "paid", updated_at: now.toISOString() })
            .eq("id", prereg.id);
          
          results.skipped++;
          continue;
        }

        // 4.1 Get user's profile and payment method
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, telegram_user_id")
          .eq("user_id", prereg.user_id)
          .single();

        if (!profile) {
          console.log(`Skipping ${prereg.id}: profile not found for user ${prereg.user_id}`);
          results.skipped++;
          continue;
        }

        // 4.2 Find active payment method
        const { data: paymentMethod } = await supabase
          .from("payment_methods")
          .select("id, provider_token, brand, last4, supports_recurring")
          .eq("user_id", prereg.user_id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!paymentMethod || !paymentMethod.provider_token) {
          console.log(`Skipping ${prereg.id}: no active payment method for user ${prereg.user_id}`);
          
          // Update billing meta for no_card
          const currentMeta = (prereg as any).meta || {};
          await supabase
            .from("course_preregistrations")
            .update({
              meta: {
                ...currentMeta,
                billing: {
                  ...(currentMeta.billing || {}),
                  billing_status: "no_card",
                  has_active_card: false,
                },
              },
              updated_at: now.toISOString(),
            })
            .eq("id", prereg.id);
          
          results.skipped++;
          continue;
        }

        // Check if card supports recurring (if not, warn but try anyway for old cards)
        if (paymentMethod.supports_recurring === false) {
          console.warn(`Warning: Payment method ${paymentMethod.id} may not support recurring charges`);
        }

        // 4.3 Generate order number
        const { data: orderNumResult } = await supabase.rpc("generate_order_number");
        const orderNumber = orderNumResult || `ORD-${Date.now()}`;

        // 4.4 Create order
        const { data: order, error: orderError } = await supabase
          .from("orders_v2")
          .insert({
            order_number: orderNumber,
            user_id: prereg.user_id,
            profile_id: profile.id,
            product_id: product.id,
            tariff_id: tariff.id,
            offer_id: chargeOffer.id,
            amount: chargeAmount,
            currency,
            status: "pending",
            customer_email: prereg.email,
            customer_phone: prereg.phone,
            customer_name: prereg.name,
            source: "preregistration_auto_charge",
            meta: {
              preregistration_id: prereg.id,
              auto_charged: true,
              charged_at: now.toISOString(),
            },
          })
          .select()
          .single();

        if (orderError || !order) {
          throw new Error(`Failed to create order: ${orderError?.message}`);
        }

        console.log(`Created order ${order.id} (${orderNumber}) for preregistration ${prereg.id}`);

        // 4.5 Create payment record
        const { data: payment, error: paymentError } = await supabase
          .from("payments_v2")
          .insert({
            order_id: order.id,
            user_id: prereg.user_id,
            profile_id: profile.id,
            amount: chargeAmount,
            currency,
            status: "processing",
            provider: "bepaid",
            payment_method_id: paymentMethod.id,
            payment_token: paymentMethod.provider_token,
            is_recurring: true,
            meta: {
              type: "preregistration_auto_charge",
              preregistration_id: prereg.id,
            },
          })
          .select()
          .single();

        if (paymentError || !payment) {
          throw new Error(`Failed to create payment: ${paymentError?.message}`);
        }

        // 4.6 Execute charge via bePaid
        const chargePayload = {
          request: {
            amount: Math.round(chargeAmount * 100), // Convert to kopecks
            currency,
            description: `${productName}: ${prereg.name}`,
            tracking_id: payment.id,
            test: testMode,
            credit_card: {
              token: paymentMethod.provider_token,
            },
            additional_data: {
              contract: ["recurring", "unscheduled"],
            },
          },
        };

        console.log(`Charging ${chargeAmount} ${currency} for preregistration ${prereg.id}`);

        const chargeResponse = await fetch("https://gateway.bepaid.by/transactions/payments", {
          method: "POST",
          headers: {
            Authorization: `Basic ${bepaidAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(chargePayload),
        });

        const chargeResult = await chargeResponse.json();
        console.log(`Charge response for ${prereg.id}:`, JSON.stringify(chargeResult).substring(0, 500));

        const txStatus = chargeResult?.transaction?.status;
        const txUid = chargeResult?.transaction?.uid;

        if (txStatus === "successful") {
          // 4.7 Update payment to successful
          await supabase
            .from("payments_v2")
            .update({
              status: "completed",
              paid_at: now.toISOString(),
              provider_payment_id: txUid,
              provider_response: chargeResult,
            })
            .eq("id", payment.id);

          // 4.8 Update order to paid
          await supabase
            .from("orders_v2")
            .update({
              status: "paid",
              paid_at: now.toISOString(),
              paid_amount: chargeAmount,
            })
            .eq("id", order.id);

          // 4.9 Create subscription
          const nextChargeAt = new Date(now);
          nextChargeAt.setMonth(nextChargeAt.getMonth() + 1);

          await supabase
            .from("subscriptions_v2")
            .insert({
              user_id: prereg.user_id,
              profile_id: profile.id,
              order_id: order.id,
              tariff_id: tariff.id,
              product_id: product.id,
              status: "active",
              payment_method_id: paymentMethod.id,
              payment_token: paymentMethod.provider_token,
              amount: chargeAmount,
              currency,
              billing_cycle: "monthly",
              next_charge_at: nextChargeAt.toISOString(),
              auto_renew: true,
              meta: {
                source: "preregistration_auto_charge",
                preregistration_id: prereg.id,
              },
            });

          // 4.10 Grant access via edge function
          await supabase.functions.invoke("grant-access-for-order", {
            body: { orderId: order.id },
          });

          // 4.11 Update preregistration to paid + billing meta
          await supabase
            .from("course_preregistrations")
            .update({
              status: "paid",
              updated_at: now.toISOString(),
              meta: {
                billing: {
                  billing_status: "paid",
                  attempts_count: 1,
                  last_attempt_at: now.toISOString(),
                  last_attempt_status: "success",
                  last_attempt_error: null,
                  has_active_card: true,
                },
              },
            })
            .eq("id", prereg.id);

          // 4.12 Send notifications
          await sendPaymentSuccessNotification(supabase, prereg.user_id, productName, chargeAmount, currency);
          await sendAdminNotification(supabase, "success", prereg.id, prereg.email, chargeAmount, currency);
          
          // 4.13 Log to telegram_logs with message_text
          await supabase.from("telegram_logs").insert({
            user_id: prereg.user_id,
            action: "PREREG_PAYMENT_SUCCESS",
            event_type: "preregistration_payment_success",
            status: "ok",
            message_text: `✅ Платёж ${chargeAmount} ${currency} за "${productName}"`,
            meta: {
              preregistration_id: prereg.id,
              amount: chargeAmount,
              currency,
              order_id: order.id,
            },
          });

          results.charged++;
          console.log(`Successfully charged preregistration ${prereg.id}`);
        } else {
          // Charge failed
          const errorMessage = chargeResult?.transaction?.message || 
                               chargeResult?.errors?.base?.[0] || 
                               "Unknown error";

          await supabase
            .from("payments_v2")
            .update({
              status: "failed",
              error_message: errorMessage,
              provider_response: chargeResult,
            })
            .eq("id", payment.id);

          await supabase
            .from("orders_v2")
            .update({
              status: "failed",
              meta: {
                ...order.meta,
                charge_error: errorMessage,
                charge_attempted_at: now.toISOString(),
              },
            })
            .eq("id", order.id);

          // Update prereg billing meta for failed attempt
          const currentMeta = (prereg as any).meta || {};
          const currentBilling = currentMeta.billing || {};
          await supabase
            .from("course_preregistrations")
            .update({
              meta: {
                ...currentMeta,
                billing: {
                  ...currentBilling,
                  billing_status: "failed",
                  attempts_count: (currentBilling.attempts_count || 0) + 1,
                  last_attempt_at: now.toISOString(),
                  last_attempt_status: "failed",
                  last_attempt_error: errorMessage,
                  has_active_card: true,
                },
              },
              updated_at: now.toISOString(),
            })
            .eq("id", prereg.id);

          await sendPaymentFailureNotification(supabase, prereg.user_id, productName, chargeAmount, currency, errorMessage);
          await sendAdminNotification(supabase, "failure", prereg.id, prereg.email, chargeAmount, currency, errorMessage);
          
          // Log failure to telegram_logs
          await supabase.from("telegram_logs").insert({
            user_id: prereg.user_id,
            action: "PREREG_PAYMENT_FAILED",
            event_type: "preregistration_payment_failed",
            status: "ok",
            message_text: `❌ Платёж не прошёл: ${errorMessage}`,
            meta: {
              preregistration_id: prereg.id,
              amount: chargeAmount,
              currency,
              error: errorMessage,
            },
          });

          results.failed++;
          results.errors.push(`${prereg.email}: ${errorMessage}`);
          console.error(`Failed to charge preregistration ${prereg.id}: ${errorMessage}`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.failed++;
        results.errors.push(`${prereg.email}: ${errorMsg}`);
        console.error(`Error processing preregistration ${prereg.id}:`, err);
      }
    }

    console.log(`Preregistration charge cron completed:`, results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Preregistration charge cron error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error),
        results 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
