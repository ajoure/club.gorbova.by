import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * SYSTEM-HEALTH-INV22-RESOLVE — Execute-step разбора зомби-подписок INV-22.
 *
 * ПРОТОКОЛ (по правкам владельца от 2026-04-29):
 *  1. Перед ремонтом — pull state из bePaid через bepaid-get-subscription-details
 *     по каждому provider_subscription_id. Это обновляет provider_subscriptions.
 *  2. Если bePaid подтверждает expired/redirecting без успешных списаний —
 *     закрыть подписку локально:
 *       - subscriptions_v2.auto_renew = false
 *       - subscriptions_v2.status = 'canceled'
 *       - subscriptions_v2.canceled_at = now()
 *       - subscriptions_v2.cancel_reason = 'inv22_provider_dead_local_active'
 *       - provider_subscriptions.state — НЕ переписываем
 *  3. Если bePaid вдруг вернул active+next_charge_at — provider_subscriptions
 *     обновится автоматически в pull-step, локально ничего не трогаем.
 *  4. Telegram-доступ НЕ отзывается. access_end_at НЕ меняется.
 *  5. audit `inv22.repair_provider_dead_local_active` per subscription.
 *
 * Безопасность:
 *  - super_admin only (JWT).
 *  - Параметр subscription_ids (наши UUID) — обязательно. Никаких bulk-all.
 *  - Каждый ID должен реально присутствовать в текущем INV-22 snapshot.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ResolveRequest {
  subscription_ids: string[];
  confirm: true;
}

interface ResolveResultItem {
  subscription_id: string;
  provider_subscription_id: string | null;
  before: {
    status: string | null;
    auto_renew: boolean | null;
    ps_state: string | null;
    ps_last_charge_at: string | null;
    ps_next_charge_at: string | null;
  };
  after: {
    status: string | null;
    auto_renew: boolean | null;
    ps_state: string | null;
    ps_last_charge_at: string | null;
    ps_next_charge_at: string | null;
  };
  pull_result:
    | "skipped_no_provider_id"
    | "succeeded"
    | "failed"
    | "not_attempted";
  delegated_to: string[];
  outcome:
    | "closed_provider_dead"
    | "kept_provider_alive"
    | "pull_failed"
    | "skipped_not_in_snapshot"
    | "audit_failed";
  audit_id?: string | null;
  audit_error?: string | null;
  notes: string;
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

    // --- Body ---
    const body: ResolveRequest = await req.json().catch(() => ({} as ResolveRequest));
    if (body.confirm !== true) {
      return new Response(
        JSON.stringify({
          error: "confirm:true required to execute INV-22 resolve",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!Array.isArray(body.subscription_ids) || body.subscription_ids.length === 0) {
      return new Response(
        JSON.stringify({
          error: "subscription_ids (non-empty array of subscriptions_v2.id) required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (body.subscription_ids.length > 50) {
      return new Response(
        JSON.stringify({ error: "Maximum 50 subscription_ids per call" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // --- 1. Re-pull current desync snapshot to validate IDs are still in scope ---
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
    const snapshotMap = new Map<string, any>();
    for (const row of rpcData?.samples ?? []) {
      snapshotMap.set(row.subscription_id, row);
    }

    const results: ResolveResultItem[] = [];

    for (const subId of body.subscription_ids) {
      const snapshotRow = snapshotMap.get(subId);
      if (!snapshotRow) {
        results.push({
          subscription_id: subId,
          provider_subscription_id: null,
          before: { status: null, auto_renew: null, ps_state: null, ps_last_charge_at: null, ps_next_charge_at: null },
          after: { status: null, auto_renew: null, ps_state: null, ps_last_charge_at: null, ps_next_charge_at: null },
          pull_result: "not_attempted",
          delegated_to: [],
          outcome: "skipped_not_in_snapshot",
          notes: "Подписка отсутствует в текущем INV-22 snapshot — возможно уже была починена. Пропуск.",
        });
        continue;
      }

      const providerSubId: string | null = snapshotRow.provider_subscription_id ?? null;

      const before = {
        status: "active",
        auto_renew: snapshotRow.auto_renew,
        ps_state: snapshotRow.ps_state,
        ps_last_charge_at: snapshotRow.ps_last_charge_at,
        ps_next_charge_at: snapshotRow.ps_next_charge_at,
      };

      const delegated: string[] = [];
      let pullResult: ResolveResultItem["pull_result"] = "skipped_no_provider_id";
      let pullPayload: any = null;
      let pullError: string | null = null;

      // --- 2. Pull state via canonical bepaid-get-subscription-details ---
      if (providerSubId) {
        try {
          const pullResp = await fetch(
            `${supabaseUrl}/functions/v1/bepaid-get-subscription-details`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader, // forward super_admin JWT
              },
              body: JSON.stringify({ subscription_id: providerSubId }),
            },
          );
          delegated.push("bepaid-get-subscription-details");
          pullPayload = await pullResp.json().catch(() => null);
          if (pullResp.ok && pullPayload?.success) {
            pullResult = "succeeded";
          } else {
            pullResult = "failed";
            pullError = pullPayload?.error ?? `HTTP ${pullResp.status}`;
          }
        } catch (e) {
          pullResult = "failed";
          pullError = e instanceof Error ? e.message : String(e);
        }
      }

      // --- 3. Re-read provider_subscriptions after pull (it may have been refreshed) ---
      const { data: psAfter } = await supabase
        .from("provider_subscriptions")
        .select("state, last_charge_at, next_charge_at")
        .eq("id", snapshotRow.provider_subscription_row_id)
        .maybeSingle();

      const psState = psAfter?.state ?? snapshotRow.ps_state;
      const psLast = psAfter?.last_charge_at ?? snapshotRow.ps_last_charge_at;
      const psNext = psAfter?.next_charge_at ?? snapshotRow.ps_next_charge_at;

      // --- 4. Decide ---
      const providerStillDead =
        psState === "expired" ||
        psState === "redirecting" ||
        (psState === "active" && psLast === null && psNext === null);

      let outcome: ResolveResultItem["outcome"];
      let after = {
        status: "active",
        auto_renew: snapshotRow.auto_renew,
        ps_state: psState,
        ps_last_charge_at: psLast,
        ps_next_charge_at: psNext,
      };
      let notes = "";

      if (pullResult === "failed") {
        outcome = "pull_failed";
        notes = `Pull из bePaid провалился: ${pullError}. Локально ничего не меняем.`;
      } else if (!providerStillDead) {
        // bePaid вернул active с реальными датами — provider_subscriptions уже обновлены pull-step
        outcome = "kept_provider_alive";
        notes =
          "После pull bePaid подтвердил живую подписку с датами списаний. Локально ничего менять не нужно.";
      } else {
        // Закрываем локально
        const nowIso = new Date().toISOString();
        const { error: updErr } = await supabase
          .from("subscriptions_v2")
          .update({
            auto_renew: false,
            status: "canceled",
            canceled_at: nowIso,
            cancel_reason: "inv22_provider_dead_local_active",
            updated_at: nowIso,
          })
          .eq("id", subId);

        if (updErr) {
          outcome = "pull_failed";
          notes = `Локальное закрытие subscriptions_v2 провалилось: ${updErr.message}`;
        } else {
          after = {
            status: "canceled",
            auto_renew: false,
            ps_state: psState,
            ps_last_charge_at: psLast,
            ps_next_charge_at: psNext,
          };
          outcome = "closed_provider_dead";
          notes =
            `Закрыли локально (auto_renew=false, status=canceled). provider_subscriptions.state=${psState} оставлен как есть. ` +
            "Telegram-доступ и access_end_at не трогали — это отдельное решение владельца.";
          delegated.push("subscriptions_v2.update");
        }
      }

      // --- 5. Per-subscription audit ---
      await supabase.from("audit_logs").insert({
        action: outcome === "closed_provider_dead"
          ? "inv22.repair_provider_dead_local_active"
          : `inv22.resolve.${outcome}`,
        actor_type: "user",
        actor_id: user.id,
        target_type: "subscription_v2",
        target_id: subId,
        metadata: {
          provider_subscription_id: providerSubId,
          before,
          after,
          pull_result: pullResult,
          pull_error: pullError,
          delegated_to: delegated,
          outcome,
          bucket: snapshotRow.bucket,
          age_hours: snapshotRow.age_hours,
        },
      });

      results.push({
        subscription_id: subId,
        provider_subscription_id: providerSubId,
        before,
        after,
        pull_result: pullResult,
        delegated_to: delegated,
        outcome,
        notes,
      });
    }

    // --- Verify: re-run RPC and report new count ---
    const { data: verifyData } = await supabase.rpc("inv22_subscription_desync", { p_limit: 1 });
    const remainingCount = verifyData?.count ?? null;

    return new Response(
      JSON.stringify({
        ok: true,
        invariant: "INV-22",
        processed: results.length,
        results,
        remaining_inv22_count: remainingCount,
        verification_query:
          "SELECT count(*) FROM subscriptions_v2 s JOIN provider_subscriptions ps ON ps.subscription_v2_id=s.id WHERE s.status='active' AND s.auto_renew=true AND s.access_end_at>now() AND (ps.state IN ('expired','redirecting') OR (ps.state='active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL));",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[inv22-resolve] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
