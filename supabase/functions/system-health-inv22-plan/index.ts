import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * SYSTEM-HEALTH-INV22-PLAN — Read-only dry-run для INV-22.
 *
 * Возвращает таблицу подписок-зомби (subscriptions_v2.active+auto_renew, но provider в expired/redirecting/active без дат)
 * с предложенным планом действий по каждой строке.
 *
 * НЕ изменяет ничего. Не трогает доступы. Не звонит в bePaid (это делает resolve).
 *
 * Гайды:
 *  - 48-часовой grace для bucket=*_redirecting (см. memory revoke-race-condition-guard).
 *  - Для bucket=active_no_dates рекомендуется pull через bepaid-get-subscription-details (это делает resolve).
 *  - Для остальных — закрытие локально (auto_renew=false, status=canceled). Доступ НЕ отзывается.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REDIRECTING_GRACE_HOURS = 48;

type Bucket =
  | "never_charged_expired"
  | "previously_charged_expired"
  | "never_charged_redirecting"
  | "previously_charged_redirecting"
  | "active_no_dates"
  | "other";

interface DesyncRow {
  subscription_id: string;
  user_id: string;
  product_id: string;
  tariff_id: string | null;
  auto_renew: boolean;
  access_end_at: string;
  s_created_at: string;
  provider_subscription_row_id: string;
  provider: string;
  provider_subscription_id: string | null;
  ps_state: string;
  ps_next_charge_at: string | null;
  ps_last_charge_at: string | null;
  ps_updated_at: string | null;
  age_hours: number;
  bucket: Bucket;
}

interface PlanItem {
  subscription_id: string;
  user_id: string;
  product_id: string;
  provider_subscription_id: string | null;
  ps_state: string;
  bucket: Bucket;
  age_hours: number;
  access_end_at: string;
  planned_action:
    | "skip_too_fresh"
    | "pull_then_decide"
    | "close_local_provider_dead";
  planned_changes: {
    subscriptions_v2?: Record<string, unknown>;
    provider_subscriptions?: "untouched";
    telegram_access?: "untouched";
    entitlements?: "untouched";
  };
  rationale: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Auth: super_admin only ---
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleCheck } = await supabase
      .from("user_roles_v2")
      .select("role_id, roles!inner(code)")
      .eq("user_id", user.id)
      .eq("roles.code", "super_admin")
      .maybeSingle();
    if (!roleCheck) {
      return new Response(
        JSON.stringify({ error: "Forbidden: super_admin only" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // --- Pull desync snapshot via canonical RPC ---
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "inv22_subscription_desync",
      { p_limit: 200 },
    );
    if (rpcErr) {
      return new Response(
        JSON.stringify({ error: `RPC failed: ${rpcErr.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const samples: DesyncRow[] = rpcData?.samples ?? [];
    const byBucket: Record<string, number> = rpcData?.by_bucket ?? {};
    const totalCount: number = rpcData?.count ?? 0;

    // --- Build plan per row ---
    const plan: PlanItem[] = samples.map((row) => {
      const isRedirecting = row.bucket.includes("redirecting");
      const tooFresh = isRedirecting && row.age_hours < REDIRECTING_GRACE_HOURS;

      if (tooFresh) {
        return {
          subscription_id: row.subscription_id,
          user_id: row.user_id,
          product_id: row.product_id,
          provider_subscription_id: row.provider_subscription_id,
          ps_state: row.ps_state,
          bucket: row.bucket,
          age_hours: row.age_hours,
          access_end_at: row.access_end_at,
          planned_action: "skip_too_fresh",
          planned_changes: {},
          rationale:
            `Подписка моложе ${REDIRECTING_GRACE_HOURS} ч и в состоянии redirecting — 3DS ещё может дойти. Не трогаем.`,
        };
      }

      if (row.bucket === "active_no_dates") {
        return {
          subscription_id: row.subscription_id,
          user_id: row.user_id,
          product_id: row.product_id,
          provider_subscription_id: row.provider_subscription_id,
          ps_state: row.ps_state,
          bucket: row.bucket,
          age_hours: row.age_hours,
          access_end_at: row.access_end_at,
          planned_action: "pull_then_decide",
          planned_changes: {
            provider_subscriptions: "untouched",
            telegram_access: "untouched",
            entitlements: "untouched",
          },
          rationale:
            "Локально provider_subscriptions=active без дат. Сначала pull актуального snapshot из bePaid через bepaid-get-subscription-details. " +
            "Если bePaid подтвердит active+next_charge_at — provider_subscriptions обновится автоматически. Если bePaid вернёт terminal — закроем локально.",
        };
      }

      // Все остальные buckets (never/previously _charged_expired, expired-redirecting за пределами grace) → закрытие локально
      return {
        subscription_id: row.subscription_id,
        user_id: row.user_id,
        product_id: row.product_id,
        provider_subscription_id: row.provider_subscription_id,
        ps_state: row.ps_state,
        bucket: row.bucket,
        age_hours: row.age_hours,
        access_end_at: row.access_end_at,
        planned_action: "close_local_provider_dead",
        planned_changes: {
          subscriptions_v2: {
            auto_renew: false,
            status: "canceled",
            canceled_at: "<now>",
            cancel_reason: "inv22_provider_dead_local_active",
          },
          provider_subscriptions: "untouched",
          telegram_access: "untouched",
          entitlements: "untouched",
        },
        rationale:
          `bePaid вернул state=${row.ps_state} (last_charge_at=${row.ps_last_charge_at ?? "NULL"}), подписке ${Math.round(row.age_hours)}ч. ` +
          `Провайдер её больше не считает живой — закрываем локально, чтобы UI не показывал «продлится автоматически». ` +
          `Доступ (access_end_at=${row.access_end_at.slice(0, 10)}) НЕ отзываем — это отдельное решение владельца.`,
      };
    });

    // --- Audit (read-only viewing) ---
    await supabase.from("audit_logs").insert({
      action: "inv22.plan.viewed",
      actor_type: "user",
      actor_id: user.id,
      target_type: "system_health",
      target_id: null,
      metadata: {
        total_count: totalCount,
        by_bucket: byBucket,
        plan_size: plan.length,
        skip_too_fresh: plan.filter((p) => p.planned_action === "skip_too_fresh").length,
        pull_then_decide: plan.filter((p) => p.planned_action === "pull_then_decide").length,
        close_local_provider_dead: plan.filter((p) => p.planned_action === "close_local_provider_dead").length,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        invariant: "INV-22",
        total_count: totalCount,
        by_bucket: byBucket,
        plan,
        notes: {
          redirecting_grace_hours: REDIRECTING_GRACE_HOURS,
          telegram_access_policy:
            "НЕ отзываем автоматически — access_end_at ещё в будущем. Решение по доступу принимает владелец отдельно.",
          provider_subscriptions_policy:
            "НЕ переписываем provider state искусственно. Оставляем то, что вернул bePaid.",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[inv22-plan] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
