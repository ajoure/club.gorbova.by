import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  evaluateCronRuns,
} from "../_shared/payment-health-policy.ts";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from "../_shared/bepaid-credentials.ts";
import { getCallerUserId } from "../_shared/caller-user.ts";
import { authorizeSystemHealth } from "./authorization.ts";
import { loadRenewalCandidates, needsRenewalProbe, verifyRenewalCandidates, RENEWAL_CHECK_RELEASE } from "./renewal-check.ts";
import { runAvailabilityBatch, summarizeAvailability, SCAN_TTL_MS, type AvailabilityScan, type FunctionCheckResult } from "./availability.ts";

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
    healthy: number; // Only a successful expected preflight, never business-runtime proof
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
  availability_scan: AvailabilityScan;
  invariants_checked_at: string | null;
  report_id?: string;
  auto_fixes: any[]; // Now always empty - remediation is separate
  duration_ms: number;
  timestamp: string;
}

async function checkBepaidRenewals(supabase: any, now: Date) {
  try {
    const rows = await loadRenewalCandidates(supabase, now.getTime());
    const needsProbe = rows.some(row => needsRenewalProbe(row, now.getTime()));
    let authorization: string | null = null;
    if (needsProbe) {
      const credentials = await getBepaidCredsStrict(supabase);
      if (!isBepaidCredsError(credentials)) authorization = createBepaidAuthHeader(credentials);
    }
    return await verifyRenewalCandidates(rows, authorization, now.getTime());
  } catch {
    // A failed read must not turn a financial invariant green or echo payloads.
    return { code: "INV-P0-1", name: "Просроченные автопродления bePaid (>24ч)",
      passed: false, count: 0, severity: "CRITICAL" as const,
      samples: [{ classification: "unknown", reason: "renewal_verification_failed" }] };
  }
}

// Check P0 business invariants
async function checkBusinessInvariants(supabase: any): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // Stale mirrors identify candidates; fresh provider GET confirms their state.
  // No subscription, payment, access or provider mutation is permitted here.
  const renewalCheck = await checkBepaidRenewals(supabase, now);
  results.push(renewalCheck);
  if ("review" in renewalCheck && renewalCheck.review.count > 0) results.push(renewalCheck.review);
  
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
    message += `Проверки доступности: ${report.edge_functions.healthy}/${report.edge_functions.total} OK (OPTIONS)\n\n`;
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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const authorized = await authorizeSystemHealth(req, supabaseServiceKey,
      Deno.env.get("CRON_SECRET"), async () => {
        const userId = await getCallerUserId(req, "system-health-full-check");
        if (!userId) return false;
        const roles = await Promise.all(["super_admin", "admin"].map(role =>
          supabase.rpc("has_role_v2", { _user_id: userId, _role_code: role })
        ));
        return roles.some(r => !r.error && r.data === true);
      });
    if (!authorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const body = await req.json().catch(() => ({}));
    if (body.action === "diagnose_renewals") {
      return new Response(JSON.stringify({ release: RENEWAL_CHECK_RELEASE,
        read_only: true, sent: false, invariant: await checkBepaidRenewals(supabase, new Date()) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body.action !== undefined) {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const source = typeof body.source === "string" ? body.source.slice(0, 64) : "manual";
    if (body.mode !== undefined && body.mode !== "continue") {
      return new Response(JSON.stringify({ error: "Unknown mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let continuationId = body.continue_from;
    if (body.mode === "continue") {
      // pg_cron starts independent requests; no recursive function-to-function
      // chain, no changed trace headers and no idle probes or repeated alerts.
      const { data: pending } = await supabase.from("system_health_reports")
        .select("id,report_json").eq("source", "cron")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const scan = pending?.report_json?.availability_scan;
      if (source !== "cron" || !scan || scan.complete
        || !Number.isFinite(Date.parse(scan.started_at)) || Date.now() - Date.parse(scan.started_at) > SCAN_TTL_MS
        || Date.parse(scan.resume_after || "") > Date.now()) {
        return new Response(JSON.stringify({ skipped: true, sent: false, reason: "no_pending_availability_scan" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      continuationId = pending.id;
    }
    
    const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");
    const expectedProjectRef = "hdjgkjceownmmnrqqtuz"; // PINNED for safety
    
    console.log(`[FULL-CHECK] Project ref: ${projectRef} (expected: ${expectedProjectRef})`);
    console.log(`[FULL-CHECK] Starting full system check (source: ${source})`);
    
    // Get previous status for comparison
    const { data: lastReport } = await supabase
      .from("system_health_reports")
      .select("id,status,report_json,source,created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const previousStatus = lastReport?.status || null;
    let priorInvariants: InvariantResult[] = lastReport?.report_json?.invariants?.results || [];
    let invariantsCheckedAt: string | null = lastReport?.report_json?.invariants_checked_at || lastReport?.created_at || null;
    
    // STEP 1: Read function list from registry (NO HARDCODE!)
    const { data: registry, error: registryError } = await supabase
      .from("edge_functions_registry")
      .select("*")
      .eq("enabled", true)
      .order("tier", { ascending: true })
      .order("name", { ascending: true });
    
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
    
    // Resume only a server-persisted predecessor. A browser cannot submit probe
    // outcomes. Each invocation performs at most20 OPTIONS without trace tricks.
    let predecessor = null;
    if (continuationId !== undefined) {
      if (typeof continuationId !== "string" || !/^[0-9a-f-]{36}$/i.test(continuationId)) {
        return new Response(JSON.stringify({ error: "invalid_availability_predecessor" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.from("system_health_reports")
        .select("id,report_json,source").eq("id", continuationId).maybeSingle();
      if (error || !data?.report_json?.availability_scan || data.source !== source) {
        return new Response(JSON.stringify({ error: "availability_predecessor_not_found" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (data.report_json.availability_scan.complete) {
        return new Response(JSON.stringify({ ...data.report_json, report_id: data.id, replayed: true, sent: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      predecessor = { scan: data.report_json.availability_scan, results: data.report_json.edge_functions.results };
      priorInvariants = data.report_json.invariants?.results || [];
      invariantsCheckedAt = data.report_json.invariants_checked_at || null;
    }
    let availability;
    try { availability = await runAvailabilityBatch(registry, supabaseUrl, predecessor || undefined); }
    catch {
      return new Response(JSON.stringify({ error: "availability_scan_expired_or_registry_changed" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const functionResults = availability.results;
    const summary = summarizeAvailability(functionResults);
    const missingFunctions = functionResults.filter(r => r.status === "NOT_DEPLOYED");
    const timeoutFunctions = functionResults.filter(r => r.status === "TIMEOUT");
    const deployedCount = summary.deployed;
    const healthyCount = summary.healthy;
    const timeoutCount = summary.timeout.length;
    const missingCount = summary.missing.length;

    // STEP 3: Check business invariants
    // Keep previously verified problems visible while the next scan is partial.
    // A partial scan must not erase a known critical business finding.
    const invariantResults = availability.scan.complete ? await checkBusinessInvariants(supabase) : priorInvariants;
    if (availability.scan.complete) invariantsCheckedAt = new Date().toISOString();
    if (availability.scan.complete) invariantResults.push({
      code: "INV-EDGE-AVAILABILITY", name: "Ошибки проверок доступности серверных функций",
      passed: summary.errors.length + missingCount === 0, count: summary.errors.length + missingCount,
      severity: "WARNING",
    });
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
      summary.errors.length > 0 || !availability.scan.complete
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
      availability_scan: availability.scan,
      invariants_checked_at: invariantsCheckedAt,
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
    
    if (saveError || !savedReport?.id) {
      console.error("[FULL-CHECK] Failed to save report");
      return new Response(JSON.stringify({ error: "health_report_persistence_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    report.report_id = savedReport.id;
    
    // Send Telegram if needed
    // Controlled release checks can persist a new truthful report without sends.
    const telegramSent = body.notify === false || !availability.scan.complete ? false : await sendTelegramAlert(supabase, report, previousStatus);
    
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
