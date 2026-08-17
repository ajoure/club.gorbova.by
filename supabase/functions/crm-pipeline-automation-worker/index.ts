import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { resolveCanonicalPayload } from "../_shared/document-render.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const workerId = `crm-automation-${crypto.randomUUID()}`;
const automationDealSelect =
  "id,order_number,profile_id,company_id,pipeline_id,pipeline_stage_id,offer_id,product_id,tariff_id,responsible_user_id,customer_email,user_id,status,currency,is_trial,paid_amount,final_price,profiles:profile_id(full_name,phone),products_v2:product_id(name),tariffs:tariff_id(name)";

type AutomationJob = {
  id: string;
  rule_id: string;
  deal_id: string;
  attempt_count: number;
};

type AutomationCondition = {
  field: string;
  operator: string;
  value?: unknown;
  not?: boolean;
};

type AutomationConditions = {
  logic: "and" | "or";
  items: AutomationCondition[];
};

function conditionMatches(
  condition: AutomationCondition,
  deal: Record<string, unknown>,
): boolean {
  const actual = deal[condition.field];
  const expected = condition.value;
  let matched = false;

  switch (condition.operator) {
    case "eq":
      matched = String(actual ?? "") === String(expected ?? "");
      break;
    case "neq":
      matched = String(actual ?? "") !== String(expected ?? "");
      break;
    case "contains":
      matched = String(actual ?? "")
        .toLocaleLowerCase()
        .includes(String(expected ?? "").toLocaleLowerCase());
      break;
    case "not_contains":
      matched = !String(actual ?? "")
        .toLocaleLowerCase()
        .includes(String(expected ?? "").toLocaleLowerCase());
      break;
    case "is_empty":
      matched = actual == null || actual === "";
      break;
    case "is_not_empty":
      matched = actual != null && actual !== "";
      break;
    case "gt":
      matched = Number(actual) > Number(expected);
      break;
    case "gte":
      matched = Number(actual) >= Number(expected);
      break;
    case "lt":
      matched = Number(actual) < Number(expected);
      break;
    case "lte":
      matched = Number(actual) <= Number(expected);
      break;
  }
  return condition.not === true ? !matched : matched;
}

function conditionsMatch(
  conditions: unknown,
  deal: Record<string, unknown>,
): boolean {
  if (
    !conditions ||
    typeof conditions !== "object" ||
    Object.keys(conditions).length === 0
  ) {
    return true;
  }
  const group = conditions as AutomationConditions;
  const results = group.items.map((condition) =>
    conditionMatches(condition, deal),
  );
  return group.logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

function resolveCustomerName(deal: Record<string, unknown>): string {
  const profile = deal.profiles;
  if (
    profile &&
    typeof profile === "object" &&
    "full_name" in profile &&
    typeof profile.full_name === "string"
  ) {
    return profile.full_name;
  }
  return "";
}

function resolveRelatedString(
  deal: Record<string, unknown>,
  relation: string,
  field: string,
): string {
  const value = deal[relation];
  if (
    value &&
    typeof value === "object" &&
    field in value &&
    typeof value[field] === "string"
  ) {
    return value[field];
  }
  return "";
}

async function buildAutomationTemplateValues(
  supabase: ReturnType<typeof createClient>,
  deal: Record<string, unknown>,
): Promise<Record<string, string>> {
  const responsibleUserId =
    typeof deal.responsible_user_id === "string"
      ? deal.responsible_user_id
      : null;
  const { data: responsible } = responsibleUserId
    ? await supabase
        .from("profiles")
        .select("full_name,email")
        .eq("user_id", responsibleUserId)
        .maybeSingle()
    : { data: null };

  const canonical = await resolveCanonicalPayload(supabase, {
    context_type: "order",
    context_id: typeof deal.id === "string" ? deal.id : null,
    company_id: typeof deal.company_id === "string" ? deal.company_id : null,
  });
  const canonicalValues = canonical.resolved_tokens;
  const customerName = resolveCustomerName(deal);
  const customerEmail = String(deal.customer_email ?? "");
  const customerPhone = resolveRelatedString(deal, "profiles", "phone");

  // Existing saved rules may still contain pre-canonical keys. Keep those
  // aliases readable, but all newly selected values come only from
  // document_token_registry and use its canonical dot notation.
  return {
    ...canonicalValues,
    "customer.name": canonicalValues["customer.name"] || customerName,
    "customer.email": canonicalValues["customer.email"] || customerEmail,
    "customer.phone": canonicalValues["customer.phone"] || customerPhone,
    customer_phone: resolveRelatedString(deal, "profiles", "phone"),
    product_name: resolveRelatedString(deal, "products_v2", "name"),
    tariff_name: resolveRelatedString(deal, "tariffs", "name"),
    responsible_name: responsible?.full_name ?? "",
    responsible_email: responsible?.email ?? "",
    deal_status: String(deal.status ?? ""),
    deal_currency: String(deal.currency ?? ""),
    paid_amount: String(deal.paid_amount ?? ""),
    final_price: String(deal.final_price ?? ""),
    is_trial: deal.is_trial === true ? "Да" : deal.is_trial === false ? "Нет" : "",
  };
}

function renderTemplate(
  template: string,
  deal: Record<string, unknown>,
  additionalValues: Record<string, string> = {},
): string {
  const customerName = resolveCustomerName(deal);
  const values: Record<string, string> = {
    deal_id: String(deal.id ?? ""),
    deal_number: String(deal.order_number ?? ""),
    customer_email: String(deal.customer_email ?? ""),
    customer_name: customerName,
    orderId: String(deal.order_number ?? ""),
    email: String(deal.customer_email ?? ""),
    name: customerName,
    appName: "Gorbova.by",
    ...additionalValues,
  };
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, rawKey) => {
    const key = String(rawKey).trim();
    return Object.hasOwn(values, key) ? values[key] : token;
  });
}

function assertTemplateResolved(value: string): string {
  const unresolved = value.match(/\{\{\s*([^{}]+?)\s*\}\}/);
  if (unresolved)
    throw new Error(`email_template_variable_unresolved:${String(unresolved[1]).trim()}`);
  return value;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();

  const workerSecret = Deno.env.get("CRM_AUTOMATION_WORKER_SECRET") ?? "";
  const providedSecret = req.headers.get("x-worker-secret") ?? "";
  const secretOk =
    workerSecret.length > 0 &&
    providedSecret.length > 0 &&
    timingSafeEqual(workerSecret, providedSecret);
  if (!secretOk) {
    console.warn(
      JSON.stringify({
        evt: "crm-automation-worker.auth_denied",
        has_configured_secret: workerSecret.length > 0,
        has_provided_secret: providedSecret.length > 0,
      }),
    );
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  console.info(JSON.stringify({ evt: "crm-automation-worker.auth_ok" }));

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = {
    ok: true,
    scheduled_rules_fired: 0,
    recurring_rules_fired: 0,
    monthly_rules_fired: 0,
    claimed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    jobs: [] as unknown[],
  };

  const { data: scheduledRulesFired, error: scheduleError } =
    await supabase.rpc("crm_pipeline_automation_enqueue_due_schedules_v10");
  if (scheduleError) {
    return new Response(
      JSON.stringify({ ok: false, error: scheduleError.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  result.scheduled_rules_fired = Number(scheduledRulesFired ?? 0);

  const { data: recurringRulesFired, error: recurrenceError } =
    await supabase.rpc("crm_pipeline_automation_enqueue_due_weekdays_v12");
  if (recurrenceError) {
    return new Response(
      JSON.stringify({ ok: false, error: recurrenceError.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  result.recurring_rules_fired = Number(recurringRulesFired ?? 0);
  const { data: monthlyRulesFired, error: monthError } = await supabase.rpc(
    "crm_pipeline_automation_enqueue_due_month_days_v13",
  );
  if (monthError)
    return new Response(
      JSON.stringify({ ok: false, error: monthError.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  result.monthly_rules_fired = Number(monthlyRulesFired ?? 0);

  const { data: jobs, error: claimError } = await supabase.rpc(
    "crm_pipeline_automation_claim_jobs",
    { _worker_id: workerId, _limit: 25 },
  );
  if (claimError) {
    return new Response(
      JSON.stringify({ ok: false, error: claimError.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  result.claimed = jobs?.length ?? 0;

  for (const job of (jobs ?? []) as AutomationJob[]) {
    try {
      const [
        { data: rule, error: ruleError },
        { data: deal, error: dealError },
      ] = await Promise.all([
        supabase
          .from("crm_pipeline_automation_rules")
          .select("*")
          .eq("id", job.rule_id)
          .single(),
        supabase
          .from("orders_v2")
          .select(automationDealSelect)
          .eq("id", job.deal_id)
          .single(),
      ]);
      if (ruleError || !rule)
        throw new Error(`rule_not_found:${ruleError?.message ?? job.rule_id}`);
      if (dealError || !deal)
        throw new Error(`deal_not_found:${dealError?.message ?? job.deal_id}`);
      const templateValues = await buildAutomationTemplateValues(supabase, deal);
      if (
        !["create_task", "send_email", "send_telegram"].includes(
          rule.action_type,
        )
      ) {
        throw new Error(`unsupported_action:${rule.action_type}`);
      }

      if (rule.action_type === "create_task") {
        const { data: existingTask, error: existingTaskError } = await supabase
          .from("crm_tasks")
          .select("id")
          .eq("pipeline_automation_rule_id", rule.id)
          .eq("deal_id", deal.id)
          .maybeSingle();
        if (existingTaskError) throw existingTaskError;
        if (existingTask) {
          await supabase.rpc("crm_pipeline_automation_complete_job", {
            _job_id: job.id,
            _succeeded: true,
            _result: {
              task_id: existingTask.id,
              recovered_existing_side_effect: true,
            },
            _error: null,
          });
          result.succeeded++;
          result.jobs.push({
            id: job.id,
            status: "succeeded",
            task_id: existingTask.id,
            recovered: true,
          });
          continue;
        }
      }

      if (rule.require_same_stage && deal.pipeline_stage_id !== rule.stage_id) {
        const { error: skipError } = await supabase.rpc(
          "crm_pipeline_automation_skip_job",
          {
            _job_id: job.id,
            _reason: "deal_left_stage",
            _result: {
              expected_stage_id: rule.stage_id,
              current_stage_id: deal.pipeline_stage_id,
            },
          },
        );
        if (skipError) throw skipError;
        result.skipped++;
        result.jobs.push({
          id: job.id,
          status: "skipped",
          reason: "deal_left_stage",
        });
        continue;
      }

      if (!conditionsMatch(rule.conditions, deal)) {
        let noBranchTaskId: string | null = null;
        if (rule.no_branch_task_type_id) {
          const {
            data: existingNoBranchTask,
            error: existingNoBranchTaskError,
          } = await supabase
            .from("crm_tasks")
            .select("id")
            .eq("pipeline_automation_rule_id", rule.id)
            .eq("deal_id", deal.id)
            .maybeSingle();
          if (existingNoBranchTaskError) throw existingNoBranchTaskError;

          if (existingNoBranchTask) {
            noBranchTaskId = existingNoBranchTask.id;
          } else {
            const assigneeUserId =
              rule.no_branch_assignee_strategy === "fixed_user"
                ? rule.no_branch_assignee_user_id
                : deal.responsible_user_id;
            const dueAt = new Date(
              Date.now() + Number(rule.no_branch_due_offset_minutes) * 60_000,
            );
            const { data: taskId, error: taskError } = await supabase.rpc(
              "crm_task_create",
              {
                payload: {
                  task_type_id: rule.no_branch_task_type_id,
                  title: renderTemplate(
                    rule.no_branch_title_template,
                    deal,
                    templateValues,
                  ),
                  description: rule.no_branch_description_template
                    ? renderTemplate(
                        rule.no_branch_description_template,
                        deal,
                        templateValues,
                      )
                    : null,
                  assignee_user_id: assigneeUserId,
                  due_at: dueAt.toISOString(),
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
                  pipeline_automation_rule_id: rule.id,
                  meta: {
                    pipeline_automation_rule_id: rule.id,
                    pipeline_automation_logical_id: rule.logical_id,
                    pipeline_automation_version: rule.version,
                    pipeline_automation_job_id: job.id,
                    pipeline_automation_branch: "no",
                  },
                },
              },
            );
            if (taskError) throw taskError;
            noBranchTaskId = taskId;
          }
        }
        const { error: skipError } = await supabase.rpc(
          "crm_pipeline_automation_skip_job",
          {
            _job_id: job.id,
            _reason: "conditions_not_met",
            _result: {
              condition_logic: rule.conditions?.logic ?? null,
              condition_count: Array.isArray(rule.conditions?.items)
                ? rule.conditions.items.length
                : 0,
              no_branch_task_id: noBranchTaskId,
            },
          },
        );
        if (skipError) throw skipError;
        result.skipped++;
        result.jobs.push({
          id: job.id,
          status: "skipped",
          reason: "conditions_not_met",
        });
        continue;
      }

      if (rule.action_type === "send_email") {
        if (!deal.customer_email)
          throw new Error("deal_customer_email_missing");
        const idempotencyKey = `crm-pipeline:${job.id}`;
        const { data: emailResult, error: emailError } =
          await supabase.functions.invoke("send-email", {
            body: {
              to: deal.customer_email,
              subject: assertTemplateResolved(
                renderTemplate(rule.email_subject_template, deal, templateValues),
              ),
              html: assertTemplateResolved(
                renderTemplate(rule.email_html_template, deal, templateValues),
              ),
              text: rule.email_text_template
                ? assertTemplateResolved(
                    renderTemplate(rule.email_text_template, deal, templateValues),
                  )
                : undefined,
              account_id: rule.email_account_id ?? undefined,
              product_id: deal.product_id ?? undefined,
              idempotency_key: idempotencyKey,
              context: {
                profile_id: deal.profile_id ?? undefined,
                company_id: deal.company_id ?? undefined,
                event_type: "crm_pipeline_automation",
                meta: {
                  deal_id: deal.id,
                  pipeline_id: deal.pipeline_id,
                  pipeline_stage_id: deal.pipeline_stage_id,
                  automation_rule_id: rule.id,
                  automation_job_id: job.id,
                  email_template_id: rule.email_template_id,
                },
              },
            },
          });
        if (emailError) throw emailError;
        if (emailResult?.error) throw new Error(emailResult.error);

        await supabase.rpc("crm_pipeline_automation_complete_job", {
          _job_id: job.id,
          _succeeded: true,
          _result: {
            channel: "email",
            to: deal.customer_email,
            log_id: emailResult?.log_id ?? null,
            queue_id: emailResult?.queue_id ?? null,
            idempotent_replay: emailResult?.idempotent_replay ?? false,
          },
          _error: null,
        });
        result.succeeded++;
        result.jobs.push({ id: job.id, status: "succeeded", channel: "email" });
        continue;
      }

      if (rule.action_type === "send_telegram") {
        if (!deal.user_id) throw new Error("deal_user_id_missing");
        const message = assertTemplateResolved(
          renderTemplate(rule.telegram_message_template, deal, templateValues),
        );
        const idempotencyKey = `crm-pipeline:${job.id}`;
        const { data: telegramResult, error: telegramError } =
          await supabase.functions.invoke("telegram-send-notification", {
            body: {
              user_id: deal.user_id,
              message_type: "crm_pipeline_automation",
              custom_message: message,
              idempotency_key: idempotencyKey,
              automation_context: {
                job_id: job.id,
                rule_id: rule.id,
                deal_id: deal.id,
              },
            },
          });
        if (telegramError) throw telegramError;
        if (!telegramResult?.success) {
          throw new Error(telegramResult?.error || "telegram_send_failed");
        }

        await supabase.rpc("crm_pipeline_automation_complete_job", {
          _job_id: job.id,
          _succeeded: true,
          _result: {
            channel: "telegram",
            telegram_message_id: telegramResult.telegram_message_id ?? null,
            idempotent_replay: telegramResult.idempotent_replay ?? false,
            mirrored_to_telegram_messages:
              telegramResult.mirrored_to_telegram_messages ?? false,
          },
          _error: null,
        });
        result.succeeded++;
        result.jobs.push({
          id: job.id,
          status: "succeeded",
          channel: "telegram",
        });
        continue;
      }

      const assigneeUserId =
        rule.assignee_strategy === "fixed_user"
          ? rule.assignee_user_id
          : deal.responsible_user_id;
      const dueAt = new Date(
        Date.now() + Number(rule.due_offset_minutes) * 60_000,
      );
      const remindAt =
        rule.reminder_offset_minutes == null
          ? null
          : new Date(
              dueAt.getTime() - Number(rule.reminder_offset_minutes) * 60_000,
            );

      const { data: taskId, error: taskError } = await supabase.rpc(
        "crm_task_create",
        {
          payload: {
            task_type_id: rule.task_type_id,
            title: renderTemplate(rule.title_template, deal, templateValues),
            description: rule.description_template
              ? renderTemplate(rule.description_template, deal, templateValues)
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
            pipeline_automation_rule_id: rule.id,
            meta: {
              pipeline_automation_rule_id: rule.id,
              pipeline_automation_logical_id: rule.logical_id,
              pipeline_automation_version: rule.version,
              pipeline_automation_job_id: job.id,
            },
          },
        },
      );
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
      const primaryError =
        error instanceof Error ? error.message : String(error);
      let fallbackError: string | null = null;

      if (job.attempt_count >= 5) {
        try {
          const [
            { data: fallbackRule, error: fallbackRuleError },
            { data: fallbackDeal, error: fallbackDealError },
          ] = await Promise.all([
            supabase
              .from("crm_pipeline_automation_rules")
              .select("*")
              .eq("id", job.rule_id)
              .single(),
            supabase
              .from("orders_v2")
              .select(automationDealSelect)
              .eq("id", job.deal_id)
              .single(),
          ]);
          if (fallbackRuleError || !fallbackRule) {
            throw new Error(
              `fallback_rule_not_found:${fallbackRuleError?.message ?? job.rule_id}`,
            );
          }
          if (fallbackDealError || !fallbackDeal) {
            throw new Error(
              `fallback_deal_not_found:${fallbackDealError?.message ?? job.deal_id}`,
            );
          }
          const fallbackTemplateValues = await buildAutomationTemplateValues(
            supabase,
            fallbackDeal,
          );

          if (fallbackRule.fallback_action_type === "send_email") {
            if (!fallbackDeal.customer_email)
              throw new Error("fallback_customer_email_missing");
            const { data: emailResult, error: emailError } =
              await supabase.functions.invoke("send-email", {
                body: {
                  to: fallbackDeal.customer_email,
                  subject: assertTemplateResolved(
                    renderTemplate(
                      fallbackRule.fallback_email_subject_template,
                      fallbackDeal,
                      fallbackTemplateValues,
                    ),
                  ),
                  html: assertTemplateResolved(
                    renderTemplate(
                      fallbackRule.fallback_email_html_template,
                      fallbackDeal,
                      fallbackTemplateValues,
                    ),
                  ),
                  text: fallbackRule.fallback_email_text_template
                    ? assertTemplateResolved(
                        renderTemplate(
                          fallbackRule.fallback_email_text_template,
                          fallbackDeal,
                          fallbackTemplateValues,
                        ),
                      )
                    : undefined,
                  account_id:
                    fallbackRule.fallback_email_account_id ?? undefined,
                  product_id: fallbackDeal.product_id ?? undefined,
                  idempotency_key: `crm-pipeline:${job.id}`,
                  context: {
                    profile_id: fallbackDeal.profile_id ?? undefined,
                    company_id: fallbackDeal.company_id ?? undefined,
                    event_type: "crm_pipeline_automation_fallback",
                    meta: {
                      deal_id: fallbackDeal.id,
                      pipeline_id: fallbackDeal.pipeline_id,
                      pipeline_stage_id: fallbackDeal.pipeline_stage_id,
                      automation_rule_id: fallbackRule.id,
                      automation_job_id: job.id,
                      email_template_id:
                        fallbackRule.fallback_email_template_id,
                      primary_error: primaryError,
                    },
                  },
                },
              });
            if (emailError) throw emailError;
            if (emailResult?.error) throw new Error(emailResult.error);

            await supabase.rpc("crm_pipeline_automation_complete_job", {
              _job_id: job.id,
              _succeeded: true,
              _result: {
                channel: "email",
                fallback_used: true,
                primary_channel: fallbackRule.action_type,
                primary_error: primaryError,
                log_id: emailResult?.log_id ?? null,
                queue_id: emailResult?.queue_id ?? null,
                idempotent_replay: emailResult?.idempotent_replay ?? false,
              },
              _error: null,
            });
            result.succeeded++;
            result.jobs.push({
              id: job.id,
              status: "succeeded",
              channel: "email",
              fallback_used: true,
            });
            continue;
          }

          if (fallbackRule.fallback_action_type === "send_telegram") {
            if (!fallbackDeal.user_id)
              throw new Error("fallback_deal_user_id_missing");
            const message = assertTemplateResolved(
              renderTemplate(
                fallbackRule.fallback_telegram_message_template,
                fallbackDeal,
                fallbackTemplateValues,
              ),
            );
            const { data: telegramResult, error: telegramError } =
              await supabase.functions.invoke("telegram-send-notification", {
                body: {
                  user_id: fallbackDeal.user_id,
                  message_type: "crm_pipeline_automation",
                  custom_message: message,
                  idempotency_key: `crm-pipeline:${job.id}`,
                  automation_context: {
                    job_id: job.id,
                    rule_id: fallbackRule.id,
                    deal_id: fallbackDeal.id,
                    fallback: true,
                  },
                },
              });
            if (telegramError) throw telegramError;
            if (!telegramResult?.success) {
              throw new Error(
                telegramResult?.error || "fallback_telegram_send_failed",
              );
            }

            await supabase.rpc("crm_pipeline_automation_complete_job", {
              _job_id: job.id,
              _succeeded: true,
              _result: {
                channel: "telegram",
                fallback_used: true,
                primary_channel: fallbackRule.action_type,
                primary_error: primaryError,
                telegram_message_id: telegramResult.telegram_message_id ?? null,
                idempotent_replay: telegramResult.idempotent_replay ?? false,
                mirrored_to_telegram_messages:
                  telegramResult.mirrored_to_telegram_messages ?? false,
              },
              _error: null,
            });
            result.succeeded++;
            result.jobs.push({
              id: job.id,
              status: "succeeded",
              channel: "telegram",
              fallback_used: true,
            });
            continue;
          }
        } catch (error) {
          fallbackError =
            error instanceof Error ? error.message : String(error);
        }
      }

      let errorBranchTaskId: string | null = null;
      if (job.attempt_count >= 5) {
        try {
          const [
            { data: errorRule, error: errorRuleError },
            { data: errorDeal, error: errorDealError },
          ] = await Promise.all([
            supabase
              .from("crm_pipeline_automation_rules")
              .select("*")
              .eq("id", job.rule_id)
              .single(),
            supabase
              .from("orders_v2")
              .select(automationDealSelect)
              .eq("id", job.deal_id)
              .single(),
          ]);
          if (errorRuleError || !errorRule) {
            throw new Error(
              `error_branch_rule_not_found:${errorRuleError?.message ?? job.rule_id}`,
            );
          }
          if (errorDealError || !errorDeal) {
            throw new Error(
              `error_branch_deal_not_found:${errorDealError?.message ?? job.deal_id}`,
            );
          }
          const errorTemplateValues = await buildAutomationTemplateValues(
            supabase,
            errorDeal,
          );
          if (errorRule.error_branch_task_type_id) {
            const { data: existingErrorTask, error: existingErrorTaskError } =
              await supabase
                .from("crm_tasks")
                .select("id")
                .eq("pipeline_automation_rule_id", errorRule.id)
                .eq("deal_id", errorDeal.id)
                .maybeSingle();
            if (existingErrorTaskError) throw existingErrorTaskError;

            if (existingErrorTask) {
              errorBranchTaskId = existingErrorTask.id;
            } else {
              const assigneeUserId =
                errorRule.error_branch_assignee_strategy === "fixed_user"
                  ? errorRule.error_branch_assignee_user_id
                  : errorDeal.responsible_user_id;
              const dueAt = new Date(
                Date.now() +
                  Number(errorRule.error_branch_due_offset_minutes) * 60_000,
              );
              const { data: taskId, error: taskError } = await supabase.rpc(
                "crm_task_create",
                {
                  payload: {
                    task_type_id: errorRule.error_branch_task_type_id,
                    title: renderTemplate(
                      errorRule.error_branch_title_template,
                      errorDeal,
                      errorTemplateValues,
                    ),
                    description: errorRule.error_branch_description_template
                      ? renderTemplate(
                          errorRule.error_branch_description_template,
                          errorDeal,
                          errorTemplateValues,
                        )
                      : null,
                    assignee_user_id: assigneeUserId,
                    due_at: dueAt.toISOString(),
                    contact_id: errorDeal.profile_id,
                    company_id: errorDeal.company_id,
                    deal_id: errorDeal.id,
                    order_id: errorDeal.id,
                    pipeline_id: errorDeal.pipeline_id,
                    pipeline_stage_id: errorDeal.pipeline_stage_id,
                    offer_id: errorDeal.offer_id,
                    product_id: errorDeal.product_id,
                    tariff_id: errorDeal.tariff_id,
                    source: "auto",
                    pipeline_automation_rule_id: errorRule.id,
                    meta: {
                      pipeline_automation_rule_id: errorRule.id,
                      pipeline_automation_logical_id: errorRule.logical_id,
                      pipeline_automation_version: errorRule.version,
                      pipeline_automation_job_id: job.id,
                      pipeline_automation_branch: "error",
                      primary_error: primaryError,
                    },
                  },
                },
              );
              if (taskError) throw taskError;
              errorBranchTaskId = taskId;
            }
          }
        } catch (error) {
          const errorBranchError =
            error instanceof Error ? error.message : String(error);
          fallbackError = fallbackError
            ? `${fallbackError}; error_branch_failed:${errorBranchError}`
            : `error_branch_failed:${errorBranchError}`;
        }
      }

      const message = fallbackError
        ? `${primaryError}; fallback_failed:${fallbackError}`
        : primaryError;
      await supabase.rpc("crm_pipeline_automation_complete_job", {
        _job_id: job.id,
        _succeeded: false,
        _result: errorBranchTaskId
          ? {
              error_branch_task_id: errorBranchTaskId,
              primary_error: primaryError,
            }
          : null,
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
