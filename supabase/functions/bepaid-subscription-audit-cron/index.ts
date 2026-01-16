import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cron job for automated subscription security audit
 * Runs daily at 03:00 AM to:
 * 1. Cancel orphan subscriptions on bePaid side
 * 2. Disable auto_renew for subscriptions without valid payment methods
 * 3. Create support tickets for any issues found
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("[bepaid-subscription-audit-cron] Starting automated security audit...");

  const auditReport = {
    run_at: new Date().toISOString(),
    external_audit: {
      subscriptions_found: 0,
      subscriptions_cancelled: 0,
      errors: [] as string[],
    },
    internal_audit: {
      at_risk_found: 0,
      auto_renew_disabled: 0,
      orphan_tokens_found: 0,
    },
    tickets_created: 0,
  };

  try {
    // Part 1: Call bepaid-subscription-audit in cancel mode
    console.log("[Cron] Running external bePaid audit...");
    
    const { data: externalAudit, error: externalError } = await supabase.functions.invoke(
      "bepaid-subscription-audit",
      { body: { action: "report" } } // First report, then cancel if needed
    );

    if (externalError) {
      console.error("[Cron] External audit error:", externalError);
      auditReport.external_audit.errors.push(externalError.message);
    } else if (externalAudit?.external) {
      auditReport.external_audit.subscriptions_found = externalAudit.external.total_found || 0;
      
      // If there are active subscriptions on bePaid that shouldn't be there
      if (externalAudit.external.total_found > 0) {
        console.log(`[Cron] Found ${externalAudit.external.total_found} external subscriptions, verifying against DB...`);
        
        // Get subscriptions that are active in our DB with auto_renew=true
        const { data: validSubs } = await supabase
          .from("subscriptions_v2")
          .select("bepaid_subscription_id")
          .in("status", ["active", "trial"])
          .eq("auto_renew", true)
          .not("bepaid_subscription_id", "is", null);
        
        const validBepaidIds = new Set((validSubs || []).map((s: any) => s.bepaid_subscription_id));
        
        // Find orphan subscriptions (active on bePaid but not valid in our DB)
        const orphanSubs = (externalAudit.external.subscriptions || []).filter(
          (sub: any) => !validBepaidIds.has(sub.id)
        );
        
        if (orphanSubs.length > 0) {
          console.log(`[Cron] Found ${orphanSubs.length} orphan subscriptions to cancel`);
          
          // Cancel orphan subscriptions
          const { data: cancelResult } = await supabase.functions.invoke(
            "bepaid-subscription-audit",
            { body: { action: "cancel_all" } }
          );
          
          auditReport.external_audit.subscriptions_cancelled = cancelResult?.external?.cancelled || 0;
        }
      }
    }

    // Part 2: Internal audit - find at-risk subscriptions
    console.log("[Cron] Running internal subscription audit...");
    
    // Find subscriptions with auto_renew=true but no payment_method_id
    const { data: atRiskSubs, error: atRiskError } = await supabase
      .from("subscriptions_v2")
      .select(`
        id,
        user_id,
        profile_id,
        payment_method_id,
        payment_token,
        status,
        profiles:profiles!subscriptions_v2_profile_id_fkey(full_name, email)
      `)
      .in("status", ["active", "trial", "past_due"])
      .eq("auto_renew", true)
      .is("payment_method_id", null);

    if (atRiskError) {
      console.error("[Cron] At-risk query error:", atRiskError);
    } else if (atRiskSubs && atRiskSubs.length > 0) {
      auditReport.internal_audit.at_risk_found = atRiskSubs.length;
      console.log(`[Cron] Found ${atRiskSubs.length} at-risk subscriptions`);
      
      // Disable auto_renew for all at-risk subscriptions
      const atRiskIds = atRiskSubs.map((s: any) => s.id);
      
      const { error: updateError } = await supabase
        .from("subscriptions_v2")
        .update({ auto_renew: false })
        .in("id", atRiskIds);
      
      if (!updateError) {
        auditReport.internal_audit.auto_renew_disabled = atRiskIds.length;
        console.log(`[Cron] Disabled auto_renew for ${atRiskIds.length} subscriptions`);
        
        // Create audit log
        await supabase.from("audit_logs").insert({
          action: "subscription.cron_security_fix",
          actor_type: "system",
          actor_label: "bepaid-subscription-audit-cron",
          meta: {
            fixed_count: atRiskIds.length,
            subscription_ids: atRiskIds.slice(0, 10), // First 10 for reference
            fix_type: "auto_renew_disabled_no_payment_method",
          },
        });
      }
    }

    // Part 3: Find orphan tokens
    const { data: orphanTokens } = await supabase
      .from("subscriptions_v2")
      .select("id")
      .in("status", ["active", "trial"])
      .not("payment_token", "is", null)
      .is("payment_method_id", null);

    auditReport.internal_audit.orphan_tokens_found = orphanTokens?.length || 0;

    // Part 4: Create support ticket if issues found
    const totalIssues = 
      auditReport.external_audit.subscriptions_cancelled +
      auditReport.internal_audit.auto_renew_disabled +
      auditReport.external_audit.errors.length;

    if (totalIssues > 0) {
      console.log(`[Cron] Creating support ticket for ${totalIssues} issues...`);
      
      const ticketContent = `
## Автоматический аудит безопасности платежей

**Дата проверки:** ${new Date().toLocaleString("ru-RU")}

### Результаты:

**Внешний контур (bePaid):**
- Найдено подписок: ${auditReport.external_audit.subscriptions_found}
- Отменено подписок: ${auditReport.external_audit.subscriptions_cancelled}
${auditReport.external_audit.errors.length > 0 ? `- Ошибки: ${auditReport.external_audit.errors.join(", ")}` : ""}

**Внутренний контур:**
- Подписок в зоне риска: ${auditReport.internal_audit.at_risk_found}
- Отключено автопродление: ${auditReport.internal_audit.auto_renew_disabled}
- Orphan-токенов: ${auditReport.internal_audit.orphan_tokens_found}

### Рекомендации:
${auditReport.internal_audit.orphan_tokens_found > 0 ? "- Проверить orphan-токены и при необходимости удалить" : ""}
${auditReport.external_audit.errors.length > 0 ? "- Проверить подключение к bePaid API" : ""}
      `.trim();

      // Insert support ticket
      const { error: ticketError } = await supabase
        .from("contact_requests")
        .insert({
          name: "Система безопасности",
          email: "system@security.audit",
          subject: `[Авто] Аудит безопасности: ${totalIssues} исправлений`,
          message: ticketContent,
          status: "new",
          consent: true,
        });

      if (!ticketError) {
        auditReport.tickets_created = 1;
        console.log("[Cron] Support ticket created");
      }
    }

    console.log("[Cron] Audit completed:", JSON.stringify(auditReport));

    return new Response(JSON.stringify({
      success: true,
      report: auditReport,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[Cron] Fatal error:", error);
    
    // Try to create error ticket
    try {
      await supabase.from("contact_requests").insert({
        name: "Система безопасности",
        email: "system@security.audit",
        subject: "[ОШИБКА] Сбой аудита безопасности",
        message: `Критическая ошибка при выполнении автоматического аудита:\n\n${error.message}\n\nТребуется ручная проверка!`,
        status: "new",
        consent: true,
      });
    } catch (ticketError) {
      console.error("[Cron] Failed to create error ticket:", ticketError);
    }

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
