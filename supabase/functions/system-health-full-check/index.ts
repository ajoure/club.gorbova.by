import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  evaluateCronRuns,
  isProviderRenewalOverdue,
} from "../_shared/payment-health-policy.ts";

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
  project_ref: string;
  expected_project_ref: string;
  edge_functions: {
    total: number;
    deployed: number;
    healthy: number;    // PATCH P0.9.4: Functions that responded (OK/ERROR/CORS_ERROR)
    timeout: string[];  // PATCH P0.9.4: Functions that timed out (exist but slow)
    missing: string[];
    results: FunctionCheckResult[];
  };
  // NEW: Structured breakdown by tier
  breakdown: {
    p0_missing: string[];
    p1_missing: string[];
    p2_missing: string[];
    cors_errors: string[];
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

// Check single function availability without executing business logic.
// A generic POST { ping: true } is not a safe healthcheck: many functions do
// not implement a ping branch and can mutate real data before rejecting it.
async function checkFunctionAvailability(
  entry: RegistryEntry,
  projectRef: string
): Promise<FunctionCheckResult> {
  const url = `https://${projectRef}.supabase.co/functions/v1/${entry.name}`;
  const timeout = Math.min(entry.timeout_ms, 8000);
  
  try {
    const controller = new AbortController();
    // Respect registry timeout_ms with an 8s cap for preflight.
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const headers: Record<string, string> = {
      "Origin": "https://gorbova.by",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,apikey,x-client-info",
    };
    
    const response = await fetch(url, {
      method: "OPTIONS",
      headers,
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
    if (entry.category === "browser") {
      const allowHeaders = (response.headers.get("Access-Control-Allow-Headers") || "").toLowerCase();
      corsOk = ["authorization", "content-type", "apikey", "x-client-info"]
        .every((requiredHeader) => allowHeaders.includes(requiredHeader));
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
        error: "Missing one or more supabase-js invocation headers in CORS allowlist",
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
    if (error instanceof Error && error.name === "AbortError") {
      // PATCH P0.9.4: TIMEOUT means function EXISTS but was slow to respond
      return {
        name: entry.name,
        exists: true, // Function exists, just slow
        http_status: null,
        status: "TIMEOUT",
        tier: entry.tier,
        category: entry.category,
        auto_fix_policy: entry.auto_fix_policy,
        error: `Request timeout (${timeout}ms)`,
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
  
  // INV-P0-1: provider subscriptions overdue beyond the provider grace window.
  // A quiet day is normal when no subscription was due. The provider snapshot,
  // not the total number of locally active subscriptions, is the source of truth.
  try {
    const { data: overdueCandidates, error: overdueError } = await supabase
      .from("provider_subscriptions")
      .select("state,next_charge_at,last_charge_at")
      .eq("state", "active")
      .not("next_charge_at", "is", null)
      .lte("next_charge_at", yesterday.toISOString())
      .limit(1000);
    if (overdueError) throw overdueError;

    const overdueRenewals = (overdueCandidates || []).filter((row: any) =>
      isProviderRenewalOverdue(row, now.getTime())
    );

    results.push({
      code: "INV-P0-1",
      name: "Просроченные автопродления bePaid (>24ч)",
      passed: overdueRenewals.length === 0,
      count: overdueRenewals.length,
      severity: "CRITICAL",
      samples: overdueRenewals.slice(0, 5).map((row: any) => ({
        next_charge_at: row.next_charge_at,
        last_charge_at: row.last_charge_at,
      })),
    });
  } catch (e) {
    results.push({
      code: "INV-P0-1",
      name: "Просроченные автопродления bePaid (>24ч)",
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
  
  // INV-P0-4: Cron jobs running (source of truth = cron.job_run_details, не audit_logs).
  // Legacy критерий (action='cron.job.triggered') давал false-red — события не пишутся с 2026-04-23.
  // Diagnose: 4912 runs / 99.9% success в последние 24ч. Proof: .lovable/proofs/inv_p0_1_p0_4_diagnose.txt
  // RPC is service-role only because cron schema is not exposed through PostgREST.
  // A bounded audit fallback prevents a false CRITICAL if PostgREST temporarily
  // misses the RPC while jobs demonstrably continue to execute.
  try {
    const { data: cronStats, error: cronErr } = await supabase
      .rpc("get_cron_runs_24h_count_v2");

    const row = Array.isArray(cronStats) ? cronStats[0] : cronStats;
    const succRuns24h = Number(row?.succ_runs_24h ?? 0);
    const totalRuns24h = Number(row?.total_runs_24h ?? 0);

    const [{ count: cronSourceCount }, { count: cronActorCount }] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .contains("meta", { source: "cron" })
        .gte("created_at", yesterday.toISOString()),
      supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .ilike("actor_label", "%cron%")
        .gte("created_at", yesterday.toISOString()),
    ]);
    const cronAuditRows = Math.max(cronSourceCount || 0, cronActorCount || 0);
    const cronEvidence = evaluateCronRuns({
      successfulRpcRuns: succRuns24h,
      cronAuditRows,
      rpcFailed: Boolean(cronErr),
    });

    results.push({
      code: "INV-P0-4",
      name: "Cron jobs за 24ч (pg_cron)",
      passed: cronEvidence.passed,
      count: cronEvidence.count,
      severity: cronEvidence.passed ? "INFO" : "CRITICAL",
      samples: [{
        source: cronEvidence.source,
        succ_runs_24h: succRuns24h,
        total_runs_24h: totalRuns24h,
        cron_audit_rows: cronAuditRows,
        rpc_error: cronErr?.message || undefined,
      }],
    });
  } catch (e) {
    results.push({
      code: "INV-P0-4",
      name: "Cron jobs за 24ч (pg_cron)",
      passed: false,
      count: 0,
      severity: "CRITICAL",
      samples: [{ error: String(e) }],
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
    const expectedProjectRef = "hdjgkjceownmmnrqqtuz"; // PINNED for safety
    
    console.log(`[FULL-CHECK] Project ref: ${projectRef} (expected: ${expectedProjectRef})`);
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
    // PATCH P0.9.4: Reduced from 30 to 10 to prevent self-DDoS on cold starts
    const batchSize = 10;
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
    
    // PATCH P0.9.4: Proper counting logic
    // - NOT_DEPLOYED = 404 only (truly missing)
    // - TIMEOUT = slow but exists
    // - deployed = everything that is NOT missing
    const isMissing = (r: FunctionCheckResult) => r.status === "NOT_DEPLOYED";
    const isTimeout = (r: FunctionCheckResult) => r.status === "TIMEOUT";
    const isHealthy = (r: FunctionCheckResult) => 
      r.status === "OK" || r.status === "ERROR" || r.status === "CORS_ERROR";
    
    const missingFunctions = functionResults.filter(isMissing);
    const timeoutFunctions = functionResults.filter(isTimeout);
    const healthyFunctions = functionResults.filter(isHealthy);
    
    const deployedCount = functionResults.filter(r => !isMissing(r)).length;
    const healthyCount = healthyFunctions.length;
    const timeoutCount = timeoutFunctions.length;
    const missingCount = missingFunctions.length;
    
    console.log(`[FULL-CHECK] total=${registry.length} deployed=${deployedCount} healthy=${healthyCount} timeout=${timeoutCount} missing=${missingCount}`);
    
    // STEP 3: Check business invariants
    const invariantResults = await checkBusinessInvariants(supabase);
    const passedInvariants = invariantResults.filter(i => i.passed).length;
    const failedCritical = invariantResults.filter(i => !i.passed && i.severity === "CRITICAL");
    
    console.log(`[FULL-CHECK] Invariants: ${passedInvariants}/${invariantResults.length} passed`);
    
    // STEP 4: Build breakdown by tier
    const missingP0 = functionResults
      .filter(r => r.status === "NOT_DEPLOYED" && r.tier === "P0")
      .map(r => r.name);
    const missingP1 = functionResults
      .filter(r => r.status === "NOT_DEPLOYED" && r.tier === "P1")
      .map(r => r.name);
    const missingP2 = functionResults
      .filter(r => r.status === "NOT_DEPLOYED" && r.tier === "P2")
      .map(r => r.name);
    const corsErrors = functionResults
      .filter(r => r.status === "CORS_ERROR")
      .map(r => r.name);
    
    console.log(`[FULL-CHECK] Breakdown: P0 missing=${missingP0.length}, P1 missing=${missingP1.length}, P2 missing=${missingP2.length}, CORS errors=${corsErrors.length}`);
    
    // STEP 5: Determine final status (ONLY P0 affects CRITICAL)
    // - CRITICAL: P0 missing OR critical invariants failed
    // - DEGRADED: P1 missing OR CORS errors in P0/P1
    // - OK: everything else (P2 missing is INFO only)
    
    let finalStatus: "OK" | "DEGRADED" | "CRITICAL" = "OK";
    
    if (failedCritical.length > 0 || missingP0.length > 0) {
      finalStatus = "CRITICAL";
    } else if (
      missingP1.length > 0 || 
      invariantResults.some(i => !i.passed && i.severity === "WARNING") ||
      corsErrors.length > 0
    ) {
      finalStatus = "DEGRADED";
    }
    // NOTE: P2 missing does NOT affect status — it's INFO only
    
    const report: FullCheckReport = {
      status: finalStatus,
      project_ref: projectRef,
      expected_project_ref: expectedProjectRef,
      edge_functions: {
        total: registry.length,
        deployed: deployedCount,
        healthy: healthyCount,
        timeout: timeoutFunctions.map(r => r.name),
        missing: missingFunctions.map(r => r.name),
        results: functionResults,
      },
      breakdown: {
        p0_missing: missingP0,
        p1_missing: missingP1,
        p2_missing: missingP2,
        cors_errors: corsErrors,
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
        edge_functions_missing: missingFunctions.map(r => r.name),
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
        project_ref: projectRef,
        expected_project_ref: expectedProjectRef,
        duration_ms: Date.now() - startTime,
        edge_functions: { 
          total: registry.length, 
          deployed_count: deployedCount, 
          healthy_count: healthyCount,
          timeout_count: timeoutCount,
          missing_count: missingCount,
        },
        breakdown: {
          p0_missing: missingP0,
          p1_missing: missingP1,
          p2_missing_count: missingP2.length,
          cors_errors: corsErrors,
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
