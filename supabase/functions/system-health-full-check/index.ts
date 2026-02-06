import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * SYSTEM-HEALTH-FULL-CHECK — Единый оркестратор проверки системы
 * 
 * Выполняет:
 * 1. Чтение списка функций из edge_functions_registry (НЕ хардкод!)
 * 2. Проверку доступности (404 detection)
 * 3. Проверку CORS для category=browser
 * 4. Проверку P0 бизнес-инвариантов
 * 5. Логирование в system_health_reports + audit_logs
 * 6. Telegram-уведомление при проблемах
 * 
 * ВАЖНО: Автолечение вынесено в отдельную функцию system-health-remediate
 */

interface RegistryEntry {
  name: string;
  tier: string;
  category: string;
  must_exist: boolean;
  healthcheck_method: string;
  expected_status: number[];
  timeout_ms: number;
  auto_fix_policy: string;
  enabled: boolean;
  notes: string | null;
}

interface FunctionCheckResult {
  name: string;
  exists: boolean;
  http_status: number | null;
  status: "OK" | "NOT_DEPLOYED" | "ERROR" | "TIMEOUT" | "CORS_ERROR";
  tier: string;
  category: string;
  auto_fix_policy: string;
  cors_ok?: boolean;
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
  auto_fixes: any[]; // Now always empty - remediation is separate
  duration_ms: number;
  timestamp: string;
}

// Check single function availability based on registry settings
// Optimized: OPTIONS timeout reduced to 5s, POST uses registry timeout
async function checkFunctionAvailability(
  entry: RegistryEntry,
  projectRef: string
): Promise<FunctionCheckResult> {
  const url = `https://${projectRef}.supabase.co/functions/v1/${entry.name}`;
  
  try {
    const controller = new AbortController();
    // Reduce timeout for OPTIONS (preflight) to 5s for faster checks
    const timeout = entry.healthcheck_method === "OPTIONS" ? 5000 : Math.min(entry.timeout_ms, 6000);
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const method = entry.healthcheck_method === "POST" ? "POST" : "OPTIONS";
    
    const headers: Record<string, string> = method === "OPTIONS" 
      ? {
          "Origin": "https://lovable.app",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type,apikey",
        }
      : {
          "Content-Type": "application/json",
        };
    
    const response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify({ ping: true }) : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // Check for NOT_DEPLOYED (404)
    if (response.status === 404) {
      const text = await response.text().catch(() => "");
      if (text.includes('"code":"NOT_FOUND"') || text.includes("Function not found")) {
        return {
          name: entry.name,
          exists: false,
          http_status: 404,
          status: "NOT_DEPLOYED",
          tier: entry.tier,
          category: entry.category,
          auto_fix_policy: entry.auto_fix_policy,
        };
      }
    }
    
    // Check CORS headers for browser functions
    let corsOk = true;
    if (entry.category === "browser" && method === "OPTIONS") {
      const allowHeaders = response.headers.get("Access-Control-Allow-Headers") || "";
      corsOk = allowHeaders.includes("x-supabase-client-platform");
    }
    
    // Check if status is in expected list
    const statusOk = entry.expected_status.includes(response.status);
    
    if (!corsOk) {
      return {
        name: entry.name,
        exists: true,
        http_status: response.status,
        status: "CORS_ERROR",
        tier: entry.tier,
        category: entry.category,
        auto_fix_policy: entry.auto_fix_policy,
        cors_ok: false,
        error: "Missing x-supabase-client-* in CORS headers",
      };
    }
    
    return {
      name: entry.name,
      exists: true,
      http_status: response.status,
      status: statusOk ? "OK" : "ERROR",
      tier: entry.tier,
      category: entry.category,
      auto_fix_policy: entry.auto_fix_policy,
      cors_ok: corsOk,
      error: statusOk ? undefined : `Unexpected status ${response.status}`,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        name: entry.name,
        exists: false,
        http_status: null,
        status: "TIMEOUT",
        tier: entry.tier,
        category: entry.category,
        auto_fix_policy: entry.auto_fix_policy,
        error: `Request timeout (${entry.timeout_ms}ms)`,
      };
    }
    
    return {
      name: entry.name,
      exists: false,
      http_status: null,
      status: "ERROR",
      tier: entry.tier,
      category: entry.category,
      auto_fix_policy: entry.auto_fix_policy,
      error: String(error),
    };
  }
}

// Check P0 business invariants
async function checkBusinessInvariants(supabase: any): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // INV-P0-1: Auto-renewals in 24h (should exist if active auto_renew subscriptions exist)
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
  
  // INV-P0-2: Renewal orders created
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
      passed: true,
      count: count || 0,
      severity: "INFO",
      samples: renewalOrders,
    });
  } catch {
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
      .lt("created_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString());
    
    const stalledQueue = (pendingCount || 0) > 5;
    
    results.push({
      code: "INV-P0-3",
      name: "Telegram queue",
      passed: !stalledQueue,
      count: completedCount || 0,
      severity: stalledQueue ? "WARNING" : "INFO",
    });
  } catch {
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
  } catch {
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
      passed: true,
      count: paymentsCount || 0,
      severity: "INFO",
    });
  } catch {
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

// Telegram notification
async function sendTelegramAlert(
  supabase: any,
  report: FullCheckReport,
  previousStatus: string | null
): Promise<boolean> {
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
    
    console.log(`[FULL-CHECK] Starting full system check (source: ${source})`);
    
    // Get previous status for comparison
    const { data: lastReport } = await supabase
      .from("system_health_reports")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const previousStatus = lastReport?.status || null;
    
    // STEP 1: Read function list from registry (NO HARDCODE!)
    const { data: registry, error: registryError } = await supabase
      .from("edge_functions_registry")
      .select("*")
      .eq("enabled", true)
      .order("tier", { ascending: true });
    
    if (registryError) {
      console.error("[FULL-CHECK] Failed to read registry:", registryError);
      return new Response(
        JSON.stringify({ error: "Failed to read edge_functions_registry", details: registryError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (!registry || registry.length === 0) {
      console.error("[FULL-CHECK] Registry is empty!");
      return new Response(
        JSON.stringify({ error: "edge_functions_registry is empty - seed it first" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[FULL-CHECK] Checking ${registry.length} functions from registry...`);
    
    // STEP 2: Check availability (parallel, batched)
    // Increased batch size from 20 to 30 for faster completion
    const batchSize = 30;
    const functionResults: FunctionCheckResult[] = [];
    let previewDetected = false;
    
    for (let i = 0; i < registry.length; i += batchSize) {
      const batch = registry.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((entry: RegistryEntry) => checkFunctionAvailability(entry, projectRef))
      );
      functionResults.push(...batchResults);
      
      // Early exit detection: if >50% of first batch is NOT_DEPLOYED, likely preview env
      if (i === 0) {
        const notDeployedCount = batchResults.filter(r => r.status === "NOT_DEPLOYED").length;
        if (notDeployedCount > batchSize * 0.5) {
          console.log(`[FULL-CHECK] Preview environment detected: ${notDeployedCount}/${batchSize} NOT_DEPLOYED in first batch`);
          previewDetected = true;
        }
      }
      
      // If preview detected and >60 functions already NOT_DEPLOYED, skip remaining
      const currentNotDeployed = functionResults.filter(r => r.status === "NOT_DEPLOYED").length;
      if (previewDetected && currentNotDeployed > 60 && i + batchSize < registry.length) {
        console.log(`[FULL-CHECK] Early exit: ${currentNotDeployed} NOT_DEPLOYED, marking remaining as NOT_DEPLOYED without requests`);
        
        // Mark remaining functions as NOT_DEPLOYED without making requests
        for (let j = i + batchSize; j < registry.length; j++) {
          const entry = registry[j] as RegistryEntry;
          functionResults.push({
            name: entry.name,
            exists: false,
            http_status: null,
            status: "NOT_DEPLOYED",
            tier: entry.tier,
            category: entry.category,
            auto_fix_policy: entry.auto_fix_policy,
            error: "Skipped (preview environment detected)",
          });
        }
        break;
      }
    }
    
    const deployedCount = functionResults.filter(r => r.exists).length;
    const missingFunctions = functionResults
      .filter(r => r.status === "NOT_DEPLOYED")
      .map(r => r.name);
    
    console.log(`[FULL-CHECK] Functions: ${deployedCount}/${registry.length} deployed`);
    
    // STEP 3: Check business invariants
    const invariantResults = await checkBusinessInvariants(supabase);
    const passedInvariants = invariantResults.filter(i => i.passed).length;
    const failedCritical = invariantResults.filter(i => !i.passed && i.severity === "CRITICAL");
    
    console.log(`[FULL-CHECK] Invariants: ${passedInvariants}/${invariantResults.length} passed`);
    
    // STEP 4: Determine final status
    // P0 function missing = CRITICAL
    const missingP0 = functionResults.filter(
      r => r.status === "NOT_DEPLOYED" && r.tier === "P0"
    );
    
    let finalStatus: "OK" | "DEGRADED" | "CRITICAL" = "OK";
    
    if (failedCritical.length > 0 || missingP0.length > 0) {
      finalStatus = "CRITICAL";
    } else if (
      missingFunctions.length > 0 || 
      invariantResults.some(i => !i.passed && i.severity === "WARNING") ||
      functionResults.some(r => r.status === "CORS_ERROR")
    ) {
      finalStatus = "DEGRADED";
    }
    
    const report: FullCheckReport = {
      status: finalStatus,
      edge_functions: {
        total: registry.length,
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
      auto_fixes: [], // Empty - remediation is now separate
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
    
    // STEP 5: Save report
    const { data: savedReport, error: saveError } = await supabase
      .from("system_health_reports")
      .insert({
        status: finalStatus,
        edge_functions_total: registry.length,
        edge_functions_deployed: deployedCount,
        edge_functions_missing: missingFunctions,
        invariants_total: invariantResults.length,
        invariants_passed: passedInvariants,
        invariants_failed: invariantResults.length - passedInvariants,
        auto_fixes: [],
        auto_fixes_count: 0,
        report_json: report,
        source,
        duration_ms: Date.now() - startTime,
        triggered_by: null,
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
    
    // Audit log with SYSTEM ACTOR PROOF
    await supabase.from("audit_logs").insert({
      action: "system.health.full_check",
      actor_type: "system",
      actor_user_id: null,
      actor_label: "system-health-full-check",
      meta: {
        report_id: savedReport?.id,
        status: finalStatus,
        duration_ms: Date.now() - startTime,
        edge_functions: { 
          total: registry.length, 
          deployed: deployedCount, 
          missing: missingFunctions.length,
          missing_p0: missingP0.map(f => f.name),
        },
        invariants: { total: invariantResults.length, passed: passedInvariants },
        source,
        telegram_notified: telegramSent,
        registry_source: true, // Proof that we used registry
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
