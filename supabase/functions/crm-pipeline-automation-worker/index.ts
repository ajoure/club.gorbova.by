import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const workerId = `crm-automation-${crypto.randomUUID()}`;

type AutomationJob = {
  id: string;
  rule_id: string;
  deal_id: string;
};

function renderTemplate(template: string, deal: Record<string, unknown>): string {
  const values: Record<string, string> = {
    deal_id: String(deal.id ?? ""),
    deal_number: String(deal.order_number ?? ""),
    customer_email: String(deal.customer_email ?? ""),
  };
  return template.replace(
    /\{\{\s*(deal_id|deal_number|customer_email)\s*\}\}/g,
    (_, key) => values[key] ?? "",
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = { ok: true, claimed: 0, succeeded: 0, failed: 0, jobs: [] as unknown[] };

  const { data: jobs, error: claimError } = await supabase.rpc(
    "crm_pipeline_automation_claim_jobs",
    { _worker_id: workerId, _limit: 25 },
  );
  if (claimError) {
    return new Response(JSON.stringify({ ok: false, error: claimError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  result.claimed = jobs?.length ?? 0;

  for (const job of (jobs ?? []) as AutomationJob[]) {
    try {
      const [{ data: rule, error: ruleError }, { data: deal, error: dealError }] =
        await Promise.all([
          supabase.from("crm_pipeline_automation_rules").select("*").eq("id", job.rule_id).single(),
          supabase
            .from("orders_v2")
            .select(
              "id,order_number,profile_id,company_id,pipeline_id,pipeline_stage_id,offer_id,product_id,tariff_id,responsible_user_id,customer_email",
            )
            .eq("id", job.deal_id)
            .single(),
        ]);
      if (ruleError || !rule) throw new Error(`rule_not_found:${ruleError?.message ?? job.rule_id}`);
      if (dealError || !deal) throw new Error(`deal_not_found:${dealError?.message ?? job.deal_id}`);
      if (rule.action_type !== "create_task") throw new Error(`unsupported_action:${rule.action_type}`);

      const assigneeUserId =
        rule.assignee_strategy === "fixed_user" ? rule.assignee_user_id : deal.responsible_user_id;
      const dueAt = new Date(Date.now() + Number(rule.due_offset_minutes) * 60_000);
      const remindAt =
        rule.reminder_offset_minutes == null
          ? null
          : new Date(dueAt.getTime() - Number(rule.reminder_offset_minutes) * 60_000);

      const { data: taskId, error: taskError } = await supabase.rpc("crm_task_create", {
        payload: {
          task_type_id: rule.task_type_id,
          title: renderTemplate(rule.title_template, deal),
          description: rule.description_template
            ? renderTemplate(rule.description_template, deal)
            : null,
          assignee_user_id: assigneeUserId,
          due_at: dueAt.toISOString(),
          remind_at: remindAt?.toISOString() ?? null,
          contact_id: deal.profile_id,
          company_id: deal.company_id,
          deal_id: deal.id,
          order_id: deal.id,
          pipeline_id: deal.pipeline_id,
          pipeline_stage_id: deal.pipeline_stage_id,
          offer_id: deal.offer_id,
          product_id: deal.product_id,
          tariff_id: deal.tariff_id,
          source: "auto",
          meta: {
            pipeline_automation_rule_id: rule.id,
            pipeline_automation_logical_id: rule.logical_id,
            pipeline_automation_version: rule.version,
            pipeline_automation_job_id: job.id,
          },
        },
      });
      if (taskError) throw taskError;

      await supabase.rpc("crm_pipeline_automation_complete_job", {
        _job_id: job.id,
        _succeeded: true,
        _result: { task_id: taskId },
        _error: null,
      });
      result.succeeded++;
      result.jobs.push({ id: job.id, status: "succeeded", task_id: taskId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.rpc("crm_pipeline_automation_complete_job", {
        _job_id: job.id,
        _succeeded: false,
        _result: null,
        _error: message,
      });
      result.failed++;
      result.jobs.push({ id: job.id, status: "failed", error: message });
    }
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
