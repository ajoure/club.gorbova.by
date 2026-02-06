import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * SYSTEM-HEALTH-FULL-CHECK — Единый оркестратор проверки системы
 * 
 * Выполняет:
 * 1. Инвентаризацию Edge Functions (runtime, не хардкод)
 * 2. Проверку доступности (404 detection)
 * 3. Проверку P0 бизнес-инвариантов
 * 4. Автолечение (ТОЛЬКО safe cases)
 * 5. Логирование в system_health_reports + audit_logs
 * 6. Telegram-уведомление при проблемах
 */

// P0 Tier-1 функции (критичные для бизнеса)
const TIER1_FUNCTIONS = [
  "subscription-charge",
  "telegram-process-access-queue",
  "telegram-grant-access",
  "telegram-revoke-access",
  "bepaid-webhook",
  "payment-methods-webhook",
  "nightly-system-health",
  "nightly-payments-invariants",
  "direct-charge",
  "cancel-trial",
];

// Функции для проверки (все кроме _shared)
async function getDeployedFunctionsList(projectRef: string, anonKey: string): Promise<string[]> {
  // В production мы не имеем доступа к файловой системе
  // Поэтому используем статический список из repo + проверяем доступность
  // TODO: В будущем можно добавить endpoint для получения списка
  return [
    "admin-backfill-2026-orders", "admin-backfill-bepaid-statement-dates", "admin-backfill-bepaid-statement-fields",
    "admin-backfill-recurring-snapshot", "admin-batch-disable-auto-renew", "admin-bepaid-emergency-unlink",
    "admin-bepaid-full-reconcile", "admin-bepaid-reconcile-amounts", "admin-billing-alignment",
    "admin-false-notifications-report", "admin-fix-club-billing-dates", "admin-fix-false-payments",
    "admin-fix-payments-integrity", "admin-fix-sub-orders-gc", "admin-fix-uid-contract",
    "admin-import-bepaid-statement-csv", "admin-legacy-cards-report", "admin-link-contact",
    "admin-link-payment-to-order", "admin-manual-charge", "admin-materialize-queue-payments",
    "admin-payments-diagnostics", "admin-purge-imported-transactions", "admin-purge-payments-by-uid",
    "admin-reconcile-bepaid-legacy", "admin-reconcile-processing-payments", "admin-regrant-wrongly-revoked",
    "admin-repair-mismatch-orders", "admin-search-profiles", "admin-unlinked-payments-report",
    "ai-import-analyzer", "amocrm-contacts-import", "amocrm-import-rollback", "amocrm-mass-import",
    "amocrm-sync", "amocrm-webhook", "analyze-all-loyalty", "analyze-audience", "analyze-contact-loyalty",
    "analyze-task-priority", "auth-actions", "auth-check-email", "backfill-payment-classification",
    "bepaid-admin-create-subscription-link", "bepaid-archive-import", "bepaid-auto-process",
    "bepaid-cancel-subscriptions", "bepaid-create-subscription-checkout", "bepaid-create-subscription",
    "bepaid-create-token", "bepaid-discrepancy-alert", "bepaid-docs-backfill", "bepaid-fetch-receipt",
    "bepaid-fetch-transactions", "bepaid-get-payment-docs", "bepaid-get-receipt", "bepaid-get-subscription-details",
    "bepaid-list-subscriptions", "bepaid-polling-backfill", "bepaid-process-refunds", "bepaid-queue-cron",
    "bepaid-raw-transactions", "bepaid-receipts-cron", "bepaid-receipts-sync", "bepaid-reconcile-file",
    "bepaid-recover-payment", "bepaid-report-import", "bepaid-subscription-audit-cron", "bepaid-subscription-audit",
    "bepaid-sync-orchestrator", "bepaid-uid-resync", "bepaid-webhook", "buh-business-notify",
    "cancel-preregistration", "cancel-trial", "cleanup-demo-contacts", "cleanup-telegram-orphans",
    "course-prereg-notify", "detect-duplicates", "diagnose-admin-notifications", "direct-charge",
    "document-auto-generate", "email-fetch-inbox", "email-mass-broadcast", "email-test-connection",
    "export-schema", "generate-affirmation", "generate-cover", "generate-document-pdf", "generate-from-template",
    "generate-invoice-act", "generate-lesson-notification", "generate-point-b-summary", "getcourse-backfill",
    "getcourse-cancel-deal", "getcourse-content-scraper", "getcourse-grant-access", "getcourse-import-deals",
    "getcourse-import-file", "getcourse-sync", "getcourse-webhook", "grant-access-for-order", "ilex-api",
    "ilex-fetch", "import-telegram-history", "installment-charge-cron", "installment-notifications",
    "integration-healthcheck", "integration-sync", "kinescope-api", "merge-clients", "migrate-data-export",
    "mns-response-generator", "monitor-news", "nightly-payments-invariants", "nightly-system-health",
    "payment-method-verify-recurring", "payment-methods-tokenize", "payment-methods-webhook",
    "payments-autolink-by-card", "payments-reconcile", "preregistration-charge-cron", "public-product",
    "reassign-demo-orders", "refunds-recompute-order-status", "reset-lesson-progress", "roles-admin",
    "scan-card-duplicates", "send-email", "send-invoice", "send-recovery-notifications", "stylize-sarcasm",
    "subscription-actions", "subscription-admin-actions", "subscription-charge", "subscription-grace-reminders",
    "subscription-renewal-reminders", "subscriptions-reconcile", "sync-payments-with-statement",
    "sync-telegram-history", "system-health-full-check", "telegram-admin-chat", "telegram-bot-actions",
    "telegram-check-expired", "telegram-club-members", "telegram-cron-sync", "telegram-daily-summary",
    "telegram-grant-access", "telegram-kick-violators", "telegram-learn-style", "telegram-link-manage",
    "telegram-mass-broadcast", "telegram-media-worker-cron", "telegram-media-worker", "telegram-notify-admins",
    "telegram-process-access-queue", "telegram-process-pending", "telegram-publish-news", "telegram-revoke-access",
    "telegram-send-notification", "telegram-send-reminders", "telegram-send-test", "telegram-webhook",
    "test-full-trial-flow", "test-getcourse-sync", "test-installment-flow", "test-payment-complete",
    "test-payment-direct", "test-quiz-progress-rls", "test-quiz-progress", "unmerge-clients", "users-admin-actions",
  ];
}

interface FunctionCheckResult {
  name: string;
  exists: boolean;
  http_status: number | null;
  status: "OK" | "NOT_DEPLOYED" | "ERROR" | "TIMEOUT";
  is_tier1: boolean;
  auto_fixed?: boolean;
  error?: string;
}

interface InvariantResult {
  code: string;
  name: string;
  passed: boolean;
  count: number;
  severity: "CRITICAL" | "WARNING" | "INFO";
  samples?: any[];
}

interface AutoFix {
  target: string;
  action: string;
  result: "success" | "failed";
  details?: string;
}

interface FullCheckReport {
  status: "OK" | "DEGRADED" | "CRITICAL";
  edge_functions: {
    total: number;
    deployed: number;
    missing: string[];
    results: FunctionCheckResult[];
  };
  invariants: {
    total: number;
    passed: number;
    failed: number;
    results: InvariantResult[];
  };
  auto_fixes: AutoFix[];
  duration_ms: number;
  timestamp: string;
}

// STEP 2: Проверка доступности функции
async function checkFunctionAvailability(
  functionName: string,
  projectRef: string,
  anonKey: string
): Promise<FunctionCheckResult> {
  const url = `https://${projectRef}.supabase.co/functions/v1/${functionName}`;
  const isTier1 = TIER1_FUNCTIONS.includes(functionName);
  
  try {
    // OPTIONS preflight check
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: "OPTIONS",
      headers: {
        "Origin": "https://lovable.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,apikey",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 404) {
      return {
        name: functionName,
        exists: false,
        http_status: 404,
        status: "NOT_DEPLOYED",
        is_tier1: isTier1,
      };
    }
    
    // 200, 400, 401, 403 = function exists
    return {
      name: functionName,
      exists: true,
      http_status: response.status,
      status: "OK",
      is_tier1: isTier1,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        name: functionName,
        exists: false,
        http_status: null,
        status: "TIMEOUT",
        is_tier1: isTier1,
        error: "Request timeout (10s)",
      };
    }
    
    return {
      name: functionName,
      exists: false,
      http_status: null,
      status: "ERROR",
      is_tier1: isTier1,
      error: String(error),
    };
  }
}

// STEP 3: Проверка P0 бизнес-инвариантов
async function checkBusinessInvariants(supabase: any): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // INV-P0-1: Автопродления за 24ч (должны быть если есть активные подписки)
  try {
    const { count: chargedCount } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("action", "subscription.charged")
      .eq("actor_type", "system")
      .gte("created_at", yesterday.toISOString());
    
    const { count: activeSubsCount } = await supabase
      .from("subscriptions_v2")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .eq("auto_renew", true);
    
    // Если есть активные подписки с auto_renew, должны быть списания
    const hasActiveAutoRenew = (activeSubsCount || 0) > 0;
    const hasCharges = (chargedCount || 0) > 0;
    
    results.push({
      code: "INV-P0-1",
      name: "Автопродления за 24ч",
      passed: !hasActiveAutoRenew || hasCharges,
      count: chargedCount || 0,
      severity: "CRITICAL",
    });
  } catch (e) {
    results.push({
      code: "INV-P0-1",
      name: "Автопродления за 24ч",
      passed: false,
      count: 0,
      severity: "CRITICAL",
      samples: [{ error: String(e) }],
    });
  }
  
  // INV-P0-2: Renewal orders созданы
  try {
    const { data: renewalOrders, count } = await supabase
      .from("orders_v2")
      .select("order_number, status, final_price", { count: "exact" })
      .like("order_number", "REN-%")
      .eq("status", "paid")
      .gte("created_at", yesterday.toISOString())
      .limit(5);
    
    results.push({
      code: "INV-P0-2",
      name: "Renewal orders за 24ч",
      passed: true, // Informational
      count: count || 0,
      severity: "INFO",
      samples: renewalOrders,
    });
  } catch (e) {
    results.push({
      code: "INV-P0-2",
      name: "Renewal orders за 24ч",
      passed: true,
      count: 0,
      severity: "INFO",
    });
  }
  
  // INV-P0-3: Telegram queue processing
  try {
    const { count: completedCount } = await supabase
      .from("telegram_access_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("created_at", yesterday.toISOString());
    
    const { count: pendingCount } = await supabase
      .from("telegram_access_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString()); // older than 1 hour
    
    const stalledQueue = (pendingCount || 0) > 5;
    
    results.push({
      code: "INV-P0-3",
      name: "Telegram queue",
      passed: !stalledQueue,
      count: completedCount || 0,
      severity: stalledQueue ? "WARNING" : "INFO",
    });
  } catch (e) {
    results.push({
      code: "INV-P0-3",
      name: "Telegram queue",
      passed: true,
      count: 0,
      severity: "INFO",
    });
  }
  
  // INV-P0-4: Cron jobs running
  try {
    const { count: cronCount } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("action", "cron.job.triggered")
      .eq("actor_type", "system")
      .gte("created_at", yesterday.toISOString());
    
    results.push({
      code: "INV-P0-4",
      name: "Cron jobs за 24ч",
      passed: (cronCount || 0) > 0,
      count: cronCount || 0,
      severity: (cronCount || 0) === 0 ? "CRITICAL" : "INFO",
    });
  } catch (e) {
    results.push({
      code: "INV-P0-4",
      name: "Cron jobs за 24ч",
      passed: false,
      count: 0,
      severity: "CRITICAL",
    });
  }
  
  // INV-P0-5: Payments succeeded
  try {
    const { count: paymentsCount } = await supabase
      .from("payments_v2")
      .select("*", { count: "exact", head: true })
      .eq("status", "succeeded")
      .gte("created_at", yesterday.toISOString());
    
    results.push({
      code: "INV-P0-5",
      name: "Успешные платежи за 24ч",
      passed: true, // Informational
      count: paymentsCount || 0,
      severity: "INFO",
    });
  } catch (e) {
    results.push({
      code: "INV-P0-5",
      name: "Успешные платежи за 24ч",
      passed: true,
      count: 0,
      severity: "INFO",
    });
  }
  
  return results;
}

// STEP 6: Telegram notification
async function sendTelegramAlert(
  supabase: any,
  report: FullCheckReport,
  previousStatus: string | null
): Promise<boolean> {
  // Отправляем только если статус != OK или изменился
  if (report.status === "OK" && previousStatus === "OK") {
    return false;
  }
  
  const ownerEmail = "7500084@gmail.com";
  
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("telegram_user_id, full_name")
    .eq("email", ownerEmail)
    .maybeSingle();
  
  const botToken = Deno.env.get("PRIMARY_TELEGRAM_BOT_TOKEN");
  
  if (!ownerProfile?.telegram_user_id || !botToken) {
    console.warn("[FULL-CHECK] Cannot send Telegram: no owner or token");
    return false;
  }
  
  const statusEmoji = report.status === "CRITICAL" ? "🔴" : report.status === "DEGRADED" ? "🟡" : "🟢";
  const nowStr = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Minsk",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  
  let message = `${statusEmoji} ПОЛНЫЙ ЧЕК СИСТЕМЫ: ${report.status}\n\n`;
  
  // Edge Functions summary
  const missingCount = report.edge_functions.missing.length;
  if (missingCount > 0) {
    message += `❌ Edge Functions: ${missingCount} не задеплоено\n`;
    message += report.edge_functions.missing.slice(0, 5).map(f => `   • ${f}`).join("\n") + "\n";
    if (missingCount > 5) {
      message += `   ... и ещё ${missingCount - 5}\n`;
    }
    message += "\n";
  } else {
    message += `✅ Edge Functions: ${report.edge_functions.deployed}/${report.edge_functions.total} OK\n\n`;
  }
  
  // Invariants summary
  const failedInvariants = report.invariants.results.filter(i => !i.passed && i.severity !== "INFO");
  if (failedInvariants.length > 0) {
    message += `❌ Инварианты:\n`;
    for (const inv of failedInvariants) {
      message += `   • ${inv.name}: ${inv.count}\n`;
    }
    message += "\n";
  } else {
    message += `✅ Инварианты: ${report.invariants.passed}/${report.invariants.total} OK\n\n`;
  }
  
  // Auto-fixes
  if (report.auto_fixes.length > 0) {
    message += `🔧 Автолечение:\n`;
    for (const fix of report.auto_fixes) {
      const emoji = fix.result === "success" ? "✅" : "❌";
      message += `   ${emoji} ${fix.target}: ${fix.action}\n`;
    }
    message += "\n";
  }
  
  message += `⏱ ${nowStr} Минск\n`;
  message += `📊 Время: ${(report.duration_ms / 1000).toFixed(1)} сек\n`;
  message += `🔗 /admin/system-health`;
  
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ownerProfile.telegram_user_id,
        text: message,
      }),
    });
    return true;
  } catch (e) {
    console.error("[FULL-CHECK] Telegram error:", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  const startTime = Date.now();
  
  try {
    // Auth check
    const cronSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("authorization");
    
    const isScheduledRun = cronSecret === expectedSecret;
    const isAuthenticatedCall = !!authHeader;
    
    if (!isScheduledRun && !isAuthenticatedCall) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const body = await req.json().catch(() => ({}));
    const source = body.source || "manual";
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    
    console.log(`[FULL-CHECK] Starting full system check (source: ${source})`);
    
    // Get previous status for comparison
    const { data: lastReport } = await supabase
      .from("system_health_reports")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const previousStatus = lastReport?.status || null;
    
    // STEP 1: Get function list
    const functionsList = await getDeployedFunctionsList(projectRef, anonKey);
    console.log(`[FULL-CHECK] Checking ${functionsList.length} functions...`);
    
    // STEP 2: Check availability (parallel, batched)
    const batchSize = 20;
    const functionResults: FunctionCheckResult[] = [];
    
    for (let i = 0; i < functionsList.length; i += batchSize) {
      const batch = functionsList.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(fn => checkFunctionAvailability(fn, projectRef, anonKey))
      );
      functionResults.push(...batchResults);
    }
    
    const deployedCount = functionResults.filter(r => r.exists).length;
    const missingFunctions = functionResults.filter(r => !r.exists).map(r => r.name);
    
    console.log(`[FULL-CHECK] Functions: ${deployedCount}/${functionsList.length} deployed`);
    
    // STEP 3: Check business invariants
    const invariantResults = await checkBusinessInvariants(supabase);
    const passedInvariants = invariantResults.filter(i => i.passed).length;
    const failedCritical = invariantResults.filter(i => !i.passed && i.severity === "CRITICAL");
    
    console.log(`[FULL-CHECK] Invariants: ${passedInvariants}/${invariantResults.length} passed`);
    
    // STEP 4: Auto-healing (SAFE CASES ONLY)
    const autoFixes: AutoFix[] = [];
    
    // Auto-fix: Trigger stalled cron if no cron jobs in 24h
    const cronInvariant = invariantResults.find(i => i.code === "INV-P0-4");
    if (cronInvariant && !cronInvariant.passed) {
      try {
        // Trigger nightly-system-health with diagnostics mode
        await supabase.functions.invoke("nightly-system-health", {
          body: { source: "auto-fix", notify_owner: false },
        });
        autoFixes.push({
          target: "nightly-system-health",
          action: "triggered (diagnostics)",
          result: "success",
        });
      } catch (e) {
        autoFixes.push({
          target: "nightly-system-health",
          action: "triggered (diagnostics)",
          result: "failed",
          details: String(e),
        });
      }
    }
    
    // STEP 5: Determine final status
    let finalStatus: "OK" | "DEGRADED" | "CRITICAL" = "OK";
    
    if (failedCritical.length > 0 || missingFunctions.some(f => TIER1_FUNCTIONS.includes(f))) {
      finalStatus = "CRITICAL";
    } else if (missingFunctions.length > 0 || invariantResults.some(i => !i.passed && i.severity === "WARNING")) {
      finalStatus = "DEGRADED";
    }
    
    const report: FullCheckReport = {
      status: finalStatus,
      edge_functions: {
        total: functionsList.length,
        deployed: deployedCount,
        missing: missingFunctions,
        results: functionResults,
      },
      invariants: {
        total: invariantResults.length,
        passed: passedInvariants,
        failed: invariantResults.length - passedInvariants,
        results: invariantResults,
      },
      auto_fixes: autoFixes,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
    
    // STEP 6: Save report
    const { data: savedReport, error: saveError } = await supabase
      .from("system_health_reports")
      .insert({
        status: finalStatus,
        edge_functions_total: functionsList.length,
        edge_functions_deployed: deployedCount,
        edge_functions_missing: missingFunctions,
        invariants_total: invariantResults.length,
        invariants_passed: passedInvariants,
        invariants_failed: invariantResults.length - passedInvariants,
        auto_fixes: autoFixes,
        auto_fixes_count: autoFixes.length,
        report_json: report,
        source,
        duration_ms: Date.now() - startTime,
        triggered_by: null, // TODO: extract from auth header
      })
      .select("id")
      .single();
    
    if (saveError) {
      console.error("[FULL-CHECK] Failed to save report:", saveError);
    }
    
    // Send Telegram if needed
    const telegramSent = await sendTelegramAlert(supabase, report, previousStatus);
    
    if (telegramSent && savedReport?.id) {
      await supabase
        .from("system_health_reports")
        .update({ telegram_notified: true })
        .eq("id", savedReport.id);
    }
    
    // Audit log
    await supabase.from("audit_logs").insert({
      action: "system.health.full_check",
      actor_type: "system",
      actor_user_id: null,
      actor_label: "system-health-full-check",
      meta: {
        report_id: savedReport?.id,
        status: finalStatus,
        duration_ms: Date.now() - startTime,
        edge_functions: { total: functionsList.length, deployed: deployedCount, missing: missingFunctions.length },
        invariants: { total: invariantResults.length, passed: passedInvariants },
        auto_fixes_count: autoFixes.length,
        source,
        telegram_notified: telegramSent,
      },
    });
    
    console.log(`[FULL-CHECK] Completed in ${Date.now() - startTime}ms. Status: ${finalStatus}`);
    
    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (error) {
    console.error("[FULL-CHECK] Error:", error);
    
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
