import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// PATCH-F: BUILD_ID for deployment verification - MUST BE UNIQUE EACH DEPLOY
const BUILD_ID = "prereg-cron:2026-02-01T23:15:00Z";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PATCH-I-2: Whitelist validation to prevent "column does not exist" errors
const ALLOWED_ORDERS_V2_FIELDS = [
  'order_number', 'user_id', 'profile_id', 'product_id', 'tariff_id', 'flow_id',
  'payment_plan_id', 'pricing_stage_id', 'base_price', 'discount_percent',
  'final_price', 'currency', 'status', 'paid_amount', 'is_trial', 'trial_end_at',
  'customer_email', 'customer_phone', 'customer_ip', 'meta', 'purchase_snapshot',
  'payer_type', 'offer_id'
];

const ALLOWED_PAYMENTS_V2_FIELDS = [
  'order_id', 'user_id', 'profile_id', 'amount', 'currency', 'status', 'provider',
  'provider_payment_id', 'provider_response', 'payment_token', 'card_last4',
  'card_brand', 'installment_number', 'is_recurring', 'error_message', 'paid_at',
  'meta', 'origin', 'transaction_type', 'payment_classification'
];

const ALLOWED_SUBSCRIPTIONS_V2_FIELDS = [
  'user_id', 'profile_id', 'order_id', 'product_id', 'tariff_id', 'flow_id', 'status',
  'access_start_at', 'access_end_at', 'is_trial', 'trial_end_at', 'next_charge_at',
  'charge_attempts', 'payment_token', 'canceled_at', 'cancel_reason', 'meta',
  'payment_method_id', 'auto_renew'
];

function pickAllowedFields(payload: Record<string, any>, allowed: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of allowed) {
    if (key in payload) result[key] = payload[key];
  }
  return result;
}

function assertRequired(payload: Record<string, any>, required: string[], ctx: string): void {
  const missing = required.filter((k) => payload[k] === undefined || payload[k] === null);
  if (missing.length) {
    throw new Error(`REQUIRED_FIELDS_MISSING(${ctx}): ${missing.join(",")}`);
  }
}

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
    console.log(`[${BUILD_ID}] Sent payment success notification to user ${userId}`);
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
    console.log(`[${BUILD_ID}] Sent payment failure notification to user ${userId}`);
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

  // PATCH-6: GUARD - Stop guards and limits
  const MAX_BATCH = 50;        // Max preregistrations per run
  const MAX_ERRORS = 10;       // Abort if too many errors
  const MAX_RUNTIME_MS = 55000; // 55 sec max runtime guard
  const startTime = Date.now();

  const results = {
    processed: 0,
    charged: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
    guards: {
      batch_limited: false,
      error_aborted: false,
      runtime_aborted: false,
    },
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
    
    console.log(`[${BUILD_ID}] START preregistration-charge-cron at ${now.toISOString()}, todayMinsk: ${todayMinsk}, dayOfMonth: ${dayOfMonth}`);

    // 1. Find preregistrations that are ready for charging
    // Status: new or contacted, with user_id set (has account)
    // PATCH-2: Added meta field to preserve existing billing data
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
        created_at,
        meta
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
    // PATCH-1: Fixed column name charge_offer_id → auto_charge_offer_id
    const { data: preregOffer } = await supabase
      .from("tariff_offers")
      .select("id, meta, auto_charge_offer_id")
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
    // PATCH-1: Fixed chargeOfferId priority: meta.preregistration.charge_offer_id → meta.charge_offer_id → auto_charge_offer_id
    const chargeOfferId = 
      meta?.preregistration?.charge_offer_id || 
      meta?.charge_offer_id || 
      preregOffer?.auto_charge_offer_id;

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

    const { data: chargeOffer, error: chargeOfferError } = await supabase
      .from("tariff_offers")
      .select(`
        id,
        amount,
        tariff_id,
        meta,
        tariffs (
          id,
          name,
          product_id,
          products_v2 (
            id,
            name,
            code
          )
        )
      `)
      .eq("id", chargeOfferId)
      .single();
    
    if (chargeOfferError) {
      console.error(`Error fetching charge offer ${chargeOfferId}: ${chargeOfferError.message}`);
      throw new Error(`Charge offer ${chargeOfferId} not found: ${chargeOfferError.message}`);
    }

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
    // PATCH-6: Apply batch limit
    const limitedPreregs = preregistrations.slice(0, MAX_BATCH);
    if (preregistrations.length > MAX_BATCH) {
      results.guards.batch_limited = true;
      console.log(`GUARD: Batch limited to ${MAX_BATCH} (total: ${preregistrations.length})`);
    }

    for (const prereg of limitedPreregs) {
      // PATCH-6: Runtime guard check
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        results.guards.runtime_aborted = true;
        console.log(`GUARD: Runtime limit reached (${MAX_RUNTIME_MS}ms), aborting`);
        break;
      }
      
      // PATCH-6: Error limit guard
      if (results.failed >= MAX_ERRORS) {
        results.guards.error_aborted = true;
        console.log(`GUARD: Max errors (${MAX_ERRORS}) reached, aborting`);
        break;
      }

      results.processed++;
      // PATCH-B: No PII in logs - only id/user_id
      console.log(`[${BUILD_ID}] Processing preregistration`, { id: prereg.id, user_id: prereg.user_id, product_code: prereg.product_code });

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

        // 4.4 Create order (using only existing columns in orders_v2)
        // Required NOT NULL columns: base_price, final_price
        const { data: order, error: orderError } = await supabase
          .from("orders_v2")
          .insert({
            order_number: orderNumber,
            user_id: prereg.user_id,
            profile_id: profile.id,
            product_id: product.id,
            tariff_id: tariff.id,
            offer_id: chargeOffer.id,
            base_price: chargeAmount,
            final_price: chargeAmount,
            currency,
            status: "pending",
            customer_email: prereg.email,
            customer_phone: prereg.phone,
            meta: {
              preregistration_id: prereg.id,
              auto_charged: true,
              charged_at: now.toISOString(),
              expected_amount: chargeAmount,
              customer_name: prereg.name,
              source: "preregistration_auto_charge",
            },
          })
          .select()
          .single();

        if (orderError || !order) {
          throw new Error(`Failed to create order: ${orderError?.message}`);
        }

        console.log(`Created order ${order.id} (${orderNumber}) for preregistration ${prereg.id}`);

        // 4.5 Create payment record - PATCH-I: Use whitelist + assertRequired
        const paymentPayloadRaw = {
          order_id: order.id,
          user_id: prereg.user_id,
          profile_id: profile.id,
          amount: chargeAmount,
          currency,
          status: "processing",
          provider: "bepaid",
          is_recurring: true,
          meta: {
            type: "preregistration_auto_charge",
            preregistration_id: prereg.id,
            payment_method_id: paymentMethod.id,
            payment_token: paymentMethod.provider_token,
          },
        };
        const paymentPayload = pickAllowedFields(paymentPayloadRaw, ALLOWED_PAYMENTS_V2_FIELDS);
        assertRequired(paymentPayload, ["order_id", "user_id", "amount", "currency", "status", "provider"], "payments_v2");
        
        const { data: payment, error: paymentError } = await supabase
          .from("payments_v2")
          .insert(paymentPayload)
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

        console.log(`[${BUILD_ID}] Charging ${chargeAmount} ${currency} for preregistration ${prereg.id}`);

        const chargeResponse = await fetch("https://gateway.bepaid.by/transactions/payments", {
          method: "POST",
          headers: {
            Authorization: `Basic ${bepaidAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(chargePayload),
        });

        const chargeResult = await chargeResponse.json();
        console.log(`[${BUILD_ID}] Charge response for prereg ${prereg.id}:`, JSON.stringify(chargeResult).substring(0, 500));

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

          // 4.8 Update order to paid (paid_at doesn't exist - store in meta)
          await supabase
            .from("orders_v2")
            .update({
              status: "paid",
              paid_amount: chargeAmount,
              meta: {
                ...((order.meta as any) || {}),
                paid_at: now.toISOString(),
              },
            })
            .eq("id", order.id);

          // 4.9 Create subscription
          const nextChargeAt = new Date(now);
          nextChargeAt.setMonth(nextChargeAt.getMonth() + 1);

          // PATCH-A: subscriptions_v2 doesn't have amount/currency/billing_cycle columns
          // Store charge details in meta instead
          // PATCH-I: Use whitelist + assertRequired for subscriptions_v2
          const subPayloadRaw = {
            user_id: prereg.user_id,
            profile_id: profile.id,
            order_id: order.id,
            tariff_id: tariff.id,
            product_id: product.id,
            status: "active",
            is_trial: false, // PATCH-I-1: NOT NULL field - required!
            payment_method_id: paymentMethod.id,
            payment_token: paymentMethod.provider_token,
            access_start_at: now.toISOString(),
            access_end_at: nextChargeAt.toISOString(),
            next_charge_at: nextChargeAt.toISOString(),
            auto_renew: true,
            meta: {
              source: "preregistration_auto_charge",
              preregistration_id: prereg.id,
              charge_amount: chargeAmount,
              charge_currency: currency,
              billing_cycle: "monthly",
            },
          };
          const subPayload = pickAllowedFields(subPayloadRaw, ALLOWED_SUBSCRIPTIONS_V2_FIELDS);
          assertRequired(subPayload, ["user_id", "product_id", "status", "access_start_at", "is_trial", "auto_renew"], "subscriptions_v2");
          
          await supabase
            .from("subscriptions_v2")
            .insert(subPayload);

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
          console.log(`[${BUILD_ID}] Successfully charged preregistration ${prereg.id}`);
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
          // PATCH-B: No PII in errors - use id only
          results.errors.push(`prereg_${prereg.id}: ${errorMessage}`);
          console.error(`[${BUILD_ID}] Failed to charge preregistration ${prereg.id}: ${errorMessage}`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.failed++;
        // PATCH-B: No PII in errors
        results.errors.push(`prereg_${prereg.id}: ${errorMsg}`);
        console.error(`[${BUILD_ID}] Error processing preregistration ${prereg.id}:`, err);
      }
    }

    console.log(`[${BUILD_ID}] END preregistration-charge-cron results:`, JSON.stringify(results));

    // PATCH-B: Include build_id in response for verification
    return new Response(JSON.stringify({ success: true, build_id: BUILD_ID, results }), {
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
