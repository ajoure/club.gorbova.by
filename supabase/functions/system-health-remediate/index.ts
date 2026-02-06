import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * SYSTEM-HEALTH-REMEDIATE — Безопасное автолечение системы
 * 
 * ПРИНЦИПЫ:
 * 1. Dry-run по умолчанию — сначала показываем план
 * 2. Только allowlist действий — никаких произвольных изменений
 * 3. Никаких SQL UPDATE/DELETE — только вызовы функций
 * 4. Никаких платежей и доступов — только инфраструктурные фиксы
 * 5. Полное логирование в audit_logs
 */

interface RemediationPlan {
  target: string;
  action: string;
  reason: string;
  auto_fix_policy: string;
  safe: boolean;
}

interface RemediationResult {
  target: string;
  action: string;
  result: "success" | "failed" | "skipped";
  details?: string;
}

interface RemediateRequest {
  mode: "dry-run" | "execute";
  targets?: string[];
  report_id?: string;
}

interface RemediateResponse {
  mode: "dry-run" | "execute";
  plan: RemediationPlan[];
  executed: boolean;
  results: RemediationResult[];
  timestamp: string;
}

// ALLOWLIST: Какие действия разрешены
const ALLOWED_ACTIONS = {
  // Перезапуск cron-функций
  restart_cron: ["nightly-system-health", "nightly-payments-invariants", "bepaid-queue-cron", 
                 "bepaid-auto-process", "subscription-charge", "telegram-process-access-queue",
                 "telegram-check-expired", "bepaid-sync-orchestrator", "getcourse-sync"],
  
  // Вызов процессоров очередей
  invoke_processor: ["telegram-process-access-queue", "bepaid-queue-cron"],
};

// BLOCKLIST: Что категорически нельзя
const BLOCKED_TARGETS = [
  // Платежные функции
  "direct-charge", "bepaid-webhook", "payment-methods-webhook",
  // Доступы
  "telegram-grant-access", "telegram-revoke-access",
  // Критичные админские
  "admin-bepaid-emergency-unlink", "admin-manual-charge",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  const startTime = Date.now();
  
  try {
    // Auth check - только authenticated пользователи
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify user is superadmin
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Check superadmin role
    const { data: roleCheck } = await supabase
      .from("user_roles_v2")
      .select("role_id, roles!inner(code)")
      .eq("user_id", user.id)
      .eq("roles.code", "superadmin")
      .maybeSingle();
    
    if (!roleCheck) {
      return new Response(
        JSON.stringify({ error: "Forbidden: superadmin only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const body: RemediateRequest = await req.json().catch(() => ({ mode: "dry-run" }));
    const mode = body.mode || "dry-run";
    const targetFilter = body.targets || [];
    
    console.log(`[REMEDIATE] Mode: ${mode}, Targets: ${targetFilter.length || "all"}`);
    
    // Step 1: Get latest health report
    const { data: latestReport } = await supabase
      .from("system_health_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (!latestReport) {
      return new Response(
        JSON.stringify({ error: "No health report found. Run full check first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Step 2: Get registry for auto_fix_policy info
    const { data: registry } = await supabase
      .from("edge_functions_registry")
      .select("*")
      .eq("enabled", true);
    
    const registryMap = new Map((registry || []).map((r: any) => [r.name, r]));
    
    // Step 3: Build remediation plan
    const plan: RemediationPlan[] = [];
    const reportJson = latestReport.report_json as any;
    
    // 3a: NOT_DEPLOYED functions with restart policy
    const missingFunctions = latestReport.edge_functions_missing || [];
    for (const fnName of missingFunctions) {
      if (targetFilter.length > 0 && !targetFilter.includes(fnName)) continue;
      if (BLOCKED_TARGETS.includes(fnName)) continue;
      
      const regEntry = registryMap.get(fnName);
      if (!regEntry) continue;
      
      if (regEntry.auto_fix_policy === "restart" && ALLOWED_ACTIONS.restart_cron.includes(fnName)) {
        plan.push({
          target: fnName,
          action: "invoke_with_diagnostics",
          reason: "NOT_DEPLOYED - attempt restart",
          auto_fix_policy: regEntry.auto_fix_policy,
          safe: true,
        });
      } else if (regEntry.auto_fix_policy === "redeploy") {
        // Note: actual CI trigger would require GitHub webhook
        plan.push({
          target: fnName,
          action: "request_redeploy",
          reason: "NOT_DEPLOYED - needs CI redeploy",
          auto_fix_policy: regEntry.auto_fix_policy,
          safe: false, // Requires manual intervention
        });
      }
    }
    
    // 3b: Stalled invariants (e.g., cron not running)
    const invariants = reportJson?.invariants?.results || [];
    const cronInvariant = invariants.find((i: any) => i.code === "INV-P0-4" && !i.passed);
    
    if (cronInvariant) {
      for (const cronFn of ALLOWED_ACTIONS.restart_cron.slice(0, 3)) {
        if (targetFilter.length > 0 && !targetFilter.includes(cronFn)) continue;
        
        plan.push({
          target: cronFn,
          action: "invoke_with_diagnostics",
          reason: "INV-P0-4 failed - cron not running",
          auto_fix_policy: "restart",
          safe: true,
        });
      }
    }
    
    // 3c: Telegram queue stalled
    const queueInvariant = invariants.find((i: any) => i.code === "INV-P0-3" && !i.passed);
    
    if (queueInvariant) {
      plan.push({
        target: "telegram-process-access-queue",
        action: "invoke_processor",
        reason: "INV-P0-3 failed - queue stalled",
        auto_fix_policy: "restart",
        safe: true,
      });
    }
    
    // Remove duplicates
    const uniquePlan = Array.from(new Map(plan.map(p => [p.target + p.action, p])).values());
    
    // Step 4: Execute if not dry-run
    const results: RemediationResult[] = [];
    let executed = false;
    
    if (mode === "execute") {
      executed = true;
      
      for (const item of uniquePlan) {
        if (!item.safe) {
          results.push({
            target: item.target,
            action: item.action,
            result: "skipped",
            details: "Requires manual intervention",
          });
          continue;
        }
        
        try {
          if (item.action === "invoke_with_diagnostics" || item.action === "invoke_processor") {
            await supabase.functions.invoke(item.target, {
              body: { source: "auto-remediate", diagnostics: true },
            });
            
            results.push({
              target: item.target,
              action: item.action,
              result: "success",
              details: "Function invoked successfully",
            });
          } else {
            results.push({
              target: item.target,
              action: item.action,
              result: "skipped",
              details: "Action not implemented",
            });
          }
        } catch (err) {
          results.push({
            target: item.target,
            action: item.action,
            result: "failed",
            details: String(err),
          });
        }
      }
      
      // Audit log for executed remediation
      await supabase.from("audit_logs").insert({
        action: "system.health.remediate",
        actor_type: "system",
        actor_user_id: user.id, // User who triggered
        actor_label: `remediate by ${user.email}`,
        meta: {
          mode,
          plan_count: uniquePlan.length,
          executed_count: results.filter(r => r.result === "success").length,
          failed_count: results.filter(r => r.result === "failed").length,
          skipped_count: results.filter(r => r.result === "skipped").length,
          report_id: latestReport.id,
          results,
        },
      });
    } else {
      // Audit log for dry-run
      await supabase.from("audit_logs").insert({
        action: "system.health.remediate.dry_run",
        actor_type: "system",
        actor_user_id: user.id,
        actor_label: `dry-run by ${user.email}`,
        meta: {
          mode,
          plan_count: uniquePlan.length,
          safe_count: uniquePlan.filter(p => p.safe).length,
          report_id: latestReport.id,
          plan: uniquePlan,
        },
      });
    }
    
    const response: RemediateResponse = {
      mode,
      plan: uniquePlan,
      executed,
      results,
      timestamp: new Date().toISOString(),
    };
    
    console.log(`[REMEDIATE] Completed. Plan: ${uniquePlan.length}, Executed: ${executed}`);
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (error) {
    console.error("[REMEDIATE] Error:", error);
    
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
