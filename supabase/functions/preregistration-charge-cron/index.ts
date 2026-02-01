import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// PATCH-F: BUILD_ID for deployment verification - MUST BE UNIQUE EACH DEPLOY
const BUILD_ID = "prereg-cron:2026-02-02T11:30:00Z";

// PATCH-0.1: Expected production shop_id - hard guard
const EXPECTED_SHOP_ID = "33524";

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

// PATCH-4: Generate window key in format "2026-02-02|09" (without TZ suffix)
function getWindowKey(now: Date): string {
  const minskFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Minsk' });
  const dateStr = minskFormatter.format(now);
  
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Minsk',
    hour: 'numeric',
    hour12: false
  });
  const minskHour = parseInt(hourFormatter.format(now), 10);
  
  // Determine which window: 09 or 21
  const windowHour = minskHour < 15 ? 9 : 21;
  return `${dateStr}|${String(windowHour).padStart(2, '0')}`;
}

// PATCH-2: Check if current time is within allowed execution windows
function isWithinExecutionWindow(now: Date): { allowed: boolean; hour: number; minute: number; reason?: string } {
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Minsk',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const timeStr = timeFormatter.format(now);
  const [hourStr, minuteStr] = timeStr.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  
  // Windows: 09:00-09:10 or 21:00-21:10
  const inMorningWindow = hour === 9 && minute <= 10;
  const inEveningWindow = hour === 21 && minute <= 10;
  
  if (inMorningWindow || inEveningWindow) {
    return { allowed: true, hour, minute };
  }
  
  return { allowed: false, hour, minute, reason: "outside_window" };
}

// PATCH-2: Check if before deadline (04.02.2026 23:59 Minsk)
function isBeforeDeadline(now: Date): boolean {
  // Deadline: 2026-02-04 23:59:59 Europe/Minsk = 2026-02-04 20:59:59 UTC
  const deadline = new Date("2026-02-04T20:59:59Z");
  return now <= deadline;
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
    "shop not found": "Магазин не найден в bePaid",
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
  errorMessage: string,
  billing: any
): Promise<boolean> {
  // PATCH-3: Anti-spam guard - check if already notified for this status
  if (billing?.notified?.failed_at) {
    console.log(`[${BUILD_ID}] Skipping failure notification - already sent at ${billing.notified.failed_at}`);
    return false;
  }
  
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("telegram_user_id, telegram_link_status, full_name")
      .eq("user_id", userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== "active") {
      return false;
    }

    const { data: linkBot } = await supabase
      .from("telegram_bots")
      .select("token")
      .eq("is_link_bot", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!linkBot?.token) return false;

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
    return true;
  } catch (err) {
    console.error("Failed to send payment failure notification:", err);
    return false;
  }
}

// PATCH-3: Send no_card notification with anti-spam guard
async function sendNoCardNotification(
  supabase: any,
  userId: string,
  productName: string,
  billing: any
): Promise<boolean> {
  // Anti-spam guard - check if already notified
  if (billing?.notified?.no_card_at) {
    console.log(`[${BUILD_ID}] Skipping no_card notification - already sent at ${billing.notified.no_card_at}`);
    return false;
  }
  
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("telegram_user_id, telegram_link_status, full_name")
      .eq("user_id", userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== "active") {
      return false;
    }

    const { data: linkBot } = await supabase
      .from("telegram_bots")
      .select("token")
      .eq("is_link_bot", true)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!linkBot?.token) return false;

    const userName = profile.full_name || "Клиент";
    const message = `⚠️ *Карта не привязана*

${userName}, у вас нет привязанной карты для автоматической оплаты.

📦 *Продукт:* ${productName}

Чтобы завершить регистрацию, привяжите карту или оплатите вручную на сайте.

🔗 [Привязать карту](https://business-training.gorbova.by/settings/payment-methods)
🔗 [Оплатить вручную](https://business-training.gorbova.by)`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    console.log(`[${BUILD_ID}] Sent no_card notification to user ${userId}`);
    return true;
  } catch (err) {
    console.error("Failed to send no_card notification:", err);
    return false;
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

// PATCH-0.1: Get bePaid shop_id from DB sources with hard guard
async function getBepaidShopId(supabase: any): Promise<{ shopId: string; source: string }> {
  // 1. Check integration_instances first
  const { data: bepaidInstance } = await supabase
    .from("integration_instances")
    .select("config")
    .eq("provider", "bepaid")
    .in("status", ["active", "connected"])
    .limit(1)
    .maybeSingle();

  const bepaidConfig = bepaidInstance?.config as Record<string, any> | null;
  if (bepaidConfig?.shop_id) {
    return { shopId: String(bepaidConfig.shop_id), source: "integration_instances" };
  }

  // 2. Fallback to payment_settings
  const { data: settings } = await supabase
    .from("payment_settings")
    .select("key, value")
    .in("key", ["bepaid_shop_id"]);

  const settingsMap = settings?.reduce((acc: Record<string, string>, s: { key: string; value: string }) => {
    acc[s.key] = s.value;
    return acc;
  }, {}) || {};

  if (settingsMap.bepaid_shop_id) {
    return { shopId: settingsMap.bepaid_shop_id, source: "payment_settings" };
  }

  // 3. Fallback to env (but NOT hardcoded fallback!)
  const envShopId = Deno.env.get("BEPAID_SHOP_ID");
  if (envShopId) {
    return { shopId: envShopId, source: "env" };
  }

  throw new Error("BEPAID_SHOP_ID not configured in integration_instances, payment_settings, or env");
}

// PATCH-0: Preflight check - verify bePaid credentials
// Strategy: Send a request with invalid token to /transactions/payments
// If credentials are valid: bePaid returns 422 with "token not found" error
// If credentials are invalid: bePaid returns 401 or 403
// This confirms shop_id and secret_key are correct without any real transaction
async function runPreflight(supabase: any, bepaidShopId: string, bepaidSecretKey: string, shopIdSource: string): Promise<{
  ok: boolean;
  build_id: string;
  host_used: string;
  shop_id_masked: string;
  shop_id_source: string;
  http_status?: number;
  transaction_status?: string;
  provider_error?: string | null;
  provider_check: string;
  charge_capability: boolean;
  recent_payments_count?: number;
}> {
  const bepaidAuth = btoa(`${bepaidShopId}:${bepaidSecretKey}`);
  const host = "gateway.bepaid.by";
  const shopIdMasked = bepaidShopId.substring(0, 3) + "**";

  console.log(`[${BUILD_ID}] Preflight: verifying credentials for shop ${shopIdMasked} (source: ${shopIdSource})`);

  try {
    // Method 1: Try a payment with invalid token
    // This verifies that credentials are accepted by bePaid
    // Expected response: 422 "Token not found" = credentials OK
    // If 401/403 = credentials invalid
    const testPayload = {
      request: {
        amount: 1, // 1 kopeck
        currency: "BYN",
        description: "Preflight credential verification",
        test: true,
        credit_card: {
          token: "preflight_invalid_token_check_12345", // Invalid token on purpose
        },
      },
    };

    const response = await fetch(`https://${host}/transactions/payments`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${bepaidAuth}`,
        "Content-Type": "application/json",
        "X-API-Version": "2",
      },
      body: JSON.stringify(testPayload),
    });

    const result = await response.json();
    
    console.log(`[${BUILD_ID}] Preflight bePaid response: status=${response.status}, body=${JSON.stringify(result)}`);
    
    // Credential check logic:
    // 401 = Invalid credentials (wrong secret key)
    // 403 = Forbidden (account issue)
    // 422 = Unprocessable Entity (expected - token invalid, but credentials OK!)
    // Other = Unknown
    const isAuthError = response.status === 401 || response.status === 403;
    const isCredentialsValid = !isAuthError;
    
    // Check if this is expected "token not found" error (means credentials work)
    const errorMessage = result.errors?.base?.[0] || result.response?.message || result.message || "";
    const isTokenError = errorMessage.toLowerCase().includes("token") || 
                         errorMessage.toLowerCase().includes("card") ||
                         errorMessage.toLowerCase().includes("credit_card");
    
    // Method 2: Additional verification via DB - check recent successful payments
    const { count: recentPaymentsCount } = await supabase
      .from("payments_v2")
      .select("*", { count: "exact", head: true })
      .eq("provider", "bepaid")
      .eq("status", "paid")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const hasRecentPayments = (recentPaymentsCount || 0) > 0;
    
    // Final determination
    const chargeCapability = isCredentialsValid && (isTokenError || hasRecentPayments);
    
    console.log(`[${BUILD_ID}] Preflight: credentials_valid=${isCredentialsValid}, token_error=${isTokenError}, recent_payments=${recentPaymentsCount}, charge_capable=${chargeCapability}`);

    return {
      ok: isCredentialsValid,
      build_id: BUILD_ID,
      host_used: host,
      shop_id_masked: shopIdMasked,
      shop_id_source: shopIdSource,
      http_status: response.status,
      provider_check: isCredentialsValid ? (isTokenError ? "token_validation" : "recent_payments") : "auth_failed",
      charge_capability: chargeCapability,
      provider_error: isCredentialsValid ? null : errorMessage,
      recent_payments_count: recentPaymentsCount || 0,
    };
  } catch (err) {
    console.error(`[${BUILD_ID}] Preflight error:`, err);
    return {
      ok: false,
      build_id: BUILD_ID,
      host_used: host,
      shop_id_masked: shopIdMasked,
      shop_id_source: shopIdSource,
      provider_error: err instanceof Error ? err.message : String(err),
      provider_check: "error",
      charge_capability: false,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const url = new URL(req.url);
  const isPreflight = url.searchParams.get("preflight") === "1";
  const isExecute = url.searchParams.get("execute") === "1";

  // PATCH-0.1: Get shop_id from DB sources with hard guard
  let bepaidShopId: string;
  let shopIdSource: string;
  
  try {
    const shopResult = await getBepaidShopId(supabase);
    bepaidShopId = shopResult.shopId;
    shopIdSource = shopResult.source;
    
    // HARD GUARD: Verify it's the expected production shop_id
    if (bepaidShopId !== EXPECTED_SHOP_ID) {
      console.error(`[${BUILD_ID}] INVALID_SHOP_ID_GUARD: got ${bepaidShopId}, expected ${EXPECTED_SHOP_ID}`);
      return new Response(JSON.stringify({
        success: false,
        build_id: BUILD_ID,
        error: `INVALID_SHOP_ID_GUARD: ${bepaidShopId}`,
        expected: EXPECTED_SHOP_ID,
        source: shopIdSource,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`[${BUILD_ID}] Using shop_id=${bepaidShopId} from ${shopIdSource}`);
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      build_id: BUILD_ID,
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const bepaidSecretKey = Deno.env.get("BEPAID_SECRET_KEY")!;
  const bepaidAuth = btoa(`${bepaidShopId}:${bepaidSecretKey}`);
  const testMode = Deno.env.get("BEPAID_TEST_MODE") === "true";

  // PATCH-0: Preflight mode - just check credentials
  if (isPreflight) {
    console.log(`[${BUILD_ID}] Running preflight check`);
    const preflightResult = await runPreflight(supabase, bepaidShopId, bepaidSecretKey, shopIdSource);
    
    console.log(`[${BUILD_ID}] Preflight result:`, JSON.stringify(preflightResult));
    
    return new Response(JSON.stringify(preflightResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
      outside_window: false,
      deadline_passed: false,
    },
  };

  try {
    const now = new Date();
    
    console.log(`[${BUILD_ID}] START preregistration-charge-cron at ${now.toISOString()}`);

    // PATCH-2: Time-guard and Deadline-guard (only for execute mode)
    if (isExecute) {
      // Check time window
      const windowCheck = isWithinExecutionWindow(now);
      if (!windowCheck.allowed) {
        console.log(`[${BUILD_ID}] Outside execution window: hour=${windowCheck.hour}, minute=${windowCheck.minute}`);
        return new Response(JSON.stringify({
          success: true,
          build_id: BUILD_ID,
          processed: 0,
          skipped_all: true,
          reason: "outside_window",
          window_info: {
            hour: windowCheck.hour,
            minute: windowCheck.minute,
            allowed_windows: "09:00-09:10, 21:00-21:10 Europe/Minsk",
          },
          guards: { ...results.guards, outside_window: true },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Check deadline
      if (!isBeforeDeadline(now)) {
        console.log(`[${BUILD_ID}] Deadline passed (2026-02-04)`);
        return new Response(JSON.stringify({
          success: true,
          build_id: BUILD_ID,
          processed: 0,
          skipped_all: true,
          reason: "deadline_passed",
          deadline: "2026-02-04",
          guards: { ...results.guards, deadline_passed: true },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // PATCH-4: Get current window key for anti-repeat
    const currentWindowKey = getWindowKey(now);
    console.log(`[${BUILD_ID}] Current window key: ${currentWindowKey}`);

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
    
    console.log(`[${BUILD_ID}] todayMinsk: ${todayMinsk}, dayOfMonth: ${dayOfMonth}`);

    // 1. Find preregistrations that are ready for charging
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
      console.log(`[${BUILD_ID}] No preregistrations found for charging`);
      console.log(`[${BUILD_ID}] END results:`, JSON.stringify(results));
      return new Response(JSON.stringify({ success: true, build_id: BUILD_ID, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${BUILD_ID}] Found ${preregistrations.length} preregistrations to check`);

    // 2. Get preregistration offer to check charge window
    const { data: preregOffer } = await supabase
      .from("tariff_offers")
      .select("id, meta, auto_charge_offer_id")
      .eq("offer_type", "preregistration")
      .eq("is_active", true)
      .single();

    if (!preregOffer) {
      console.log(`[${BUILD_ID}] No active preregistration offer found`);
      console.log(`[${BUILD_ID}] END results:`, JSON.stringify(results));
      return new Response(JSON.stringify({ success: true, build_id: BUILD_ID, results, message: "No preregistration offer" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = preregOffer.meta as any || {};
    const chargeWindowStart = meta.preregistration?.charge_window_start || meta.charge_window_start || 1;
    const chargeWindowEnd = meta.preregistration?.charge_window_end || meta.charge_window_end || 4;
    const firstChargeDate = meta.preregistration?.first_charge_date || meta.first_charge_date;
    const chargeOfferId = 
      meta?.preregistration?.charge_offer_id || 
      meta?.charge_offer_id || 
      preregOffer?.auto_charge_offer_id;

    // Check first_charge_date
    if (firstChargeDate && todayMinsk < firstChargeDate) {
      console.log(`[${BUILD_ID}] Today ${todayMinsk} is before first_charge_date ${firstChargeDate}`);
      console.log(`[${BUILD_ID}] END results:`, JSON.stringify(results));
      return new Response(JSON.stringify({ 
        success: true, 
        build_id: BUILD_ID,
        results, 
        message: `Before first charge date (${firstChargeDate})` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if day of month is within charge window (1-4)
    if (dayOfMonth < chargeWindowStart || dayOfMonth > chargeWindowEnd) {
      console.log(`[${BUILD_ID}] Day ${dayOfMonth} is outside charge window ${chargeWindowStart}-${chargeWindowEnd}`);
      console.log(`[${BUILD_ID}] END results:`, JSON.stringify(results));
      return new Response(JSON.stringify({ 
        success: true, 
        build_id: BUILD_ID,
        results, 
        message: `Outside charge window (day ${dayOfMonth} not in ${chargeWindowStart}-${chargeWindowEnd})` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`[${BUILD_ID}] Charge window check passed: day ${dayOfMonth} is within ${chargeWindowStart}-${chargeWindowEnd}`);

    // 3. Get the charge offer details
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

    console.log(`[${BUILD_ID}] Charge offer: ${chargeAmount} ${currency} for ${productName}`);

    // 4. Process each preregistration
    const limitedPreregs = preregistrations.slice(0, MAX_BATCH);
    if (preregistrations.length > MAX_BATCH) {
      results.guards.batch_limited = true;
      console.log(`[${BUILD_ID}] GUARD: Batch limited to ${MAX_BATCH} (total: ${preregistrations.length})`);
    }

    for (const prereg of limitedPreregs) {
      // Runtime guard check
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        results.guards.runtime_aborted = true;
        console.log(`[${BUILD_ID}] GUARD: Runtime limit reached (${MAX_RUNTIME_MS}ms), aborting`);
        break;
      }
      
      // Error limit guard
      if (results.failed >= MAX_ERRORS) {
        results.guards.error_aborted = true;
        console.log(`[${BUILD_ID}] GUARD: Max errors (${MAX_ERRORS}) reached, aborting`);
        break;
      }

      results.processed++;
      console.log(`[${BUILD_ID}] Processing preregistration`, { id: prereg.id, user_id: prereg.user_id, product_code: prereg.product_code });

      try {
        const currentMeta = (prereg as any).meta || {};
        const currentBilling = currentMeta.billing || {};

        // PATCH-4: Anti-repeat check - skip if already processed in this window
        if (currentBilling.last_attempt_window_key === currentWindowKey) {
          console.log(`[${BUILD_ID}] Skipping prereg ${prereg.id}: already processed in window ${currentWindowKey}`);
          results.skipped++;
          continue;
        }

        // Check if user already has a paid order
        const { data: existingPaidOrder } = await supabase
          .from("orders_v2")
          .select("id, order_number")
          .eq("product_id", product.id)
          .eq("status", "paid")
          .or(`user_id.eq.${prereg.user_id},customer_email.ilike.${prereg.email}`)
          .limit(1)
          .maybeSingle();

        if (existingPaidOrder) {
          console.log(`[${BUILD_ID}] Skipping ${prereg.id}: user already has paid order ${existingPaidOrder.order_number}`);
          
          await supabase
            .from("course_preregistrations")
            .update({ status: "paid", updated_at: now.toISOString() })
            .eq("id", prereg.id);
          
          results.skipped++;
          continue;
        }

        // Get user's profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, telegram_user_id")
          .eq("user_id", prereg.user_id)
          .single();

        if (!profile) {
          console.log(`[${BUILD_ID}] Skipping ${prereg.id}: profile not found for user ${prereg.user_id}`);
          results.skipped++;
          continue;
        }

        // Find active payment method
        const { data: paymentMethod } = await supabase
          .from("payment_methods")
          .select("id, provider_token, brand, last4, supports_recurring")
          .eq("user_id", prereg.user_id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!paymentMethod || !paymentMethod.provider_token) {
          console.log(`[${BUILD_ID}] No payment method for prereg ${prereg.id}`);
          
          // PATCH-3: Send no_card notification with anti-spam guard
          const notified = await sendNoCardNotification(supabase, prereg.user_id, productName, currentBilling);
          
          // Update billing meta for no_card
          await supabase
            .from("course_preregistrations")
            .update({
              meta: {
                ...currentMeta,
                billing: {
                  ...currentBilling,
                  billing_status: "no_card",
                  has_active_card: false,
                  last_attempt_window_key: currentWindowKey,
                  notified: {
                    ...currentBilling.notified,
                    ...(notified ? { no_card_at: now.toISOString() } : {}),
                  },
                },
              },
              updated_at: now.toISOString(),
            })
            .eq("id", prereg.id);
          
          // Log to telegram_logs
          if (notified) {
            await supabase.from("telegram_logs").insert({
              user_id: prereg.user_id,
              action: "PREREG_NO_CARD_WARNING",
              event_type: "preregistration_no_card",
              status: "ok",
              message_text: `⚠️ Карта не привязана для "${productName}"`,
              meta: { preregistration_id: prereg.id },
            });
          }
          
          results.skipped++;
          continue;
        }

        // Check if card supports recurring
        if (paymentMethod.supports_recurring === false) {
          console.warn(`[${BUILD_ID}] Warning: Payment method ${paymentMethod.id} may not support recurring charges`);
        }

        // Generate order number
        const { data: orderNumResult } = await supabase.rpc("generate_order_number");
        const orderNumber = orderNumResult || `ORD-${Date.now()}`;

        // Create order
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

        console.log(`[${BUILD_ID}] Created order ${order.id} (${orderNumber}) for preregistration ${prereg.id}`);

        // Create payment record
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

        // Execute charge via bePaid
        const chargePayload = {
          request: {
            amount: Math.round(chargeAmount * 100),
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
          // Update payment to successful
          await supabase
            .from("payments_v2")
            .update({
              status: "completed",
              paid_at: now.toISOString(),
              provider_payment_id: txUid,
              provider_response: chargeResult,
            })
            .eq("id", payment.id);

          // Update order to paid
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

          // Create subscription
          const nextChargeAt = new Date(now);
          nextChargeAt.setMonth(nextChargeAt.getMonth() + 1);

          const subPayloadRaw = {
            user_id: prereg.user_id,
            profile_id: profile.id,
            order_id: order.id,
            tariff_id: tariff.id,
            product_id: product.id,
            status: "active",
            is_trial: false,
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

          // Grant access via edge function
          await supabase.functions.invoke("grant-access-for-order", {
            body: { orderId: order.id },
          });

          // Update preregistration to paid + billing meta
          await supabase
            .from("course_preregistrations")
            .update({
              status: "paid",
              updated_at: now.toISOString(),
              meta: {
                billing: {
                  billing_status: "paid",
                  attempts_count: (currentBilling.attempts_count || 0) + 1,
                  last_attempt_at: now.toISOString(),
                  last_attempt_window_key: currentWindowKey,
                  last_attempt_status: "success",
                  last_attempt_error: null,
                  has_active_card: true,
                },
              },
            })
            .eq("id", prereg.id);

          // Send notifications
          await sendPaymentSuccessNotification(supabase, prereg.user_id, productName, chargeAmount, currency);
          await sendAdminNotification(supabase, "success", prereg.id, prereg.email, chargeAmount, currency);
          
          // Log to telegram_logs
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

          // PATCH-3: Send failure notification with anti-spam guard
          const notified = await sendPaymentFailureNotification(
            supabase, prereg.user_id, productName, chargeAmount, currency, errorMessage, currentBilling
          );

          // Update prereg billing meta for failed attempt
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
                  last_attempt_window_key: currentWindowKey,
                  last_attempt_status: "failed",
                  last_attempt_error: errorMessage,
                  has_active_card: true,
                  notified: {
                    ...currentBilling.notified,
                    ...(notified ? { failed_at: now.toISOString() } : {}),
                  },
                },
              },
              updated_at: now.toISOString(),
            })
            .eq("id", prereg.id);

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
          results.errors.push(`prereg_${prereg.id}: ${errorMessage}`);
          console.error(`[${BUILD_ID}] Failed to charge preregistration ${prereg.id}: ${errorMessage}`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.failed++;
        results.errors.push(`prereg_${prereg.id}: ${errorMsg}`);
        console.error(`[${BUILD_ID}] Error processing preregistration ${prereg.id}:`, err);
      }
    }

    console.log(`[${BUILD_ID}] END preregistration-charge-cron results:`, JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, build_id: BUILD_ID, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[${BUILD_ID}] Preregistration charge cron error:`, error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        build_id: BUILD_ID,
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
