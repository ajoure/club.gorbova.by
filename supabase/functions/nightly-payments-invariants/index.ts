// reference: deno.land/x/types/index.d.ts

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const invariants: any[] = [];

    // INV-18: recent orphans (24h)
    const { data: recentOrphans } = await supabase
      .from("provider_webhook_orphans")
      .select("id, reason, created_at")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(200);

    const orphanCount = (recentOrphans || []).length;
    invariants.push({
      name: "INV-18: recent orphans (24h)",
      passed: orphanCount === 0,
      count: orphanCount,
      samples: (recentOrphans || []).slice(0, 5).map((o: any) => ({ reason: o.reason })),
      description: "Orphans created by webhook processing (24h).",
    });

    if ((orphanCount || 0) > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            message:
              `⚠️ INV-18: ${orphanCount} необработанных orphan(s) за 24ч\n\nПричины: ${
                [...new Set((recentOrphans || []).map((o: any) => o.reason))].join(", ")
              }`,
            source: "nightly-payments-invariants",
          }),
        });
      } catch (_) {}
    }

    // -------------------------
    // INV-19A: BePaid sbs_* missing in provider_subscriptions
    // -------------------------
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    const { data: payRows } = await supabase
      .from("payments_v2")
      .select("id, meta, provider_response, created_at")
      .eq("provider", "bepaid")
      .eq("status", "succeeded")
      .gte("created_at", seventyTwoHoursAgo)
      .limit(200);

    const { data: ordRows } = await supabase
      .from("orders_v2")
      .select("id, meta, created_at")
      .gte("created_at", seventyTwoHoursAgo)
      .limit(200);

    const allSbsIds = new Set<string>();

    for (const p of payRows || []) {
      const metaSbs = (p.meta as any)?.bepaid_subscription_id;
      if (typeof metaSbs === "string" && metaSbs.startsWith("sbs_")) allSbsIds.add(metaSbs);

      const respSbs = (p.provider_response as any)?.subscription_id;
      if (typeof respSbs === "string" && respSbs.startsWith("sbs_")) allSbsIds.add(respSbs);
    }

    for (const o of ordRows || []) {
      const metaSbs = (o.meta as any)?.bepaid_subscription_id;
      if (typeof metaSbs === "string" && metaSbs.startsWith("sbs_")) allSbsIds.add(metaSbs);
    }

    let inv19aMissing: string[] = [];
    if (allSbsIds.size > 0) {
      const { data: existingPS } = await supabase
        .from("provider_subscriptions")
        .select("provider_subscription_id")
        .eq("provider", "bepaid")
        .in("provider_subscription_id", [...allSbsIds]);

      const existingSet = new Set((existingPS || []).map((ps: any) => ps.provider_subscription_id));
      inv19aMissing = [...allSbsIds].filter((id) => !existingSet.has(id));
    }

    invariants.push({
      name: "INV-19A: BePaid sbs_* missing in provider_subscriptions",
      passed: inv19aMissing.length === 0,
      count: inv19aMissing.length,
      samples: inv19aMissing.slice(0, 5).map((id) => ({ sbs_id: id })),
      description:
        "BePaid subscription IDs found in payments/orders (72h) but missing from provider_subscriptions. Run admin-bepaid-backfill.",
    });

    if (inv19aMissing.length > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            message:
              `🚨 INV-19A CRITICAL: ${inv19aMissing.length} BePaid sbs_* ID(s) найдены в платежах/заказах, но отсутствуют в provider_subscriptions!\n\nРекомендация: запустить admin-bepaid-backfill execute`,
            source: "nightly-payments-invariants",
          }),
        });
      } catch (_) {}
    }

    // -------------------------
    // INV-19B: Token recurring without provider_subscriptions
    // -------------------------
    const { data: inv19bSubs } = await supabase
      .from("subscriptions_v2")
      .select("id, user_id, product_id")
      .in("status", ["active", "trial", "past_due"])
      .eq("auto_renew", true)
      .in("billing_type", ["provider_managed"])
      .limit(500);

    let inv19bMissing = 0;

    if (inv19bSubs && inv19bSubs.length > 0) {
      const inv19bUserIds = [...new Set(inv19bSubs.map((s: any) => s.user_id))];

      const { data: inv19bPMs } = await supabase
        .from("payment_methods")
        .select("user_id")
        .eq("provider", "bepaid")
        .eq("status", "active")
        .in("user_id", inv19bUserIds);

      const usersWithPM = new Set((inv19bPMs || []).map((pm: any) => pm.user_id));
      const relevantSubs = inv19bSubs.filter((s: any) => usersWithPM.has(s.user_id));

      if (relevantSubs.length > 0) {
        const { data: inv19bExisting } = await supabase
          .from("provider_subscriptions")
          .select("subscription_v2_id")
          .eq("provider", "bepaid")
          .in("subscription_v2_id", relevantSubs.map((s: any) => s.id));

        const coveredSubIds = new Set((inv19bExisting || []).map((ps: any) => ps.subscription_v2_id));
        inv19bMissing = relevantSubs.filter((s: any) => !coveredSubIds.has(s.id)).length;
      }
    }

    const inv19bCritical = inv19bMissing > 20;
    invariants.push({
      name: "INV-19B: Token recurring without provider_subscriptions",
      passed: inv19bMissing === 0,
      count: inv19bMissing,
      samples: [],
      description:
        `Active auto_renew subscriptions with bepaid payment_method but no provider_subscriptions row (by subscription_v2_id). ${
          inv19bCritical ? "CRITICAL" : "WARNING"
        }. Run admin-bepaid-backfill.`,
    });

    if (inv19bCritical) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            message:
              `🚨 INV-19B CRITICAL: ${inv19bMissing} активных auto_renew подписок без provider_subscriptions!\n\nРекомендация: запустить admin-bepaid-backfill execute`,
            source: "nightly-payments-invariants",
          }),
        });
      } catch (_) {}
    }

    // INV-20 (v2): Actionable paid orders without payments_v2 (30-day window)
    // Separates real "needs repair" from synthetic imports / orphan / suppressed.
    let inv20Actionable = 0;
    let inv20Orphan = 0;
    let inv20Synthetic = 0;
    let inv20Suppressed = 0;
    let inv20Total = 0;
    let inv20Samples: any[] = [];

    const { data: inv20Data, error: inv20Err } = await supabase.rpc(
      "inv20_paid_orders_actionable",
      { p_limit: 5 }
    );

    if (inv20Err) {
      console.error("[nightly] INV-20 RPC failed:", inv20Err.message);
      invariants.push({
        name: "INV-20: Actionable paid orders without payments_v2 (30d)",
        passed: false,
        count: -1,
        description: `RPC inv20_paid_orders_actionable failed: ${inv20Err.message}.`,
      });
    } else if (inv20Data) {
      inv20Actionable = Number(inv20Data?.actionable_count ?? 0);
      inv20Orphan = Number(inv20Data?.orphan_count ?? 0);
      inv20Synthetic = Number(inv20Data?.synthetic_count ?? 0);
      inv20Suppressed = Number(inv20Data?.suppressed_count ?? 0);
      inv20Total = Number(inv20Data?.total ?? 0);
      inv20Samples = inv20Data?.samples ?? [];
    }

    // Always log the full breakdown for visibility (orphan/synthetic are NOT alerts)
    console.log(
      `[nightly] INV-20 30d breakdown — actionable=${inv20Actionable} orphan=${inv20Orphan} synthetic=${inv20Synthetic} suppressed=${inv20Suppressed} total=${inv20Total}`
    );

    const inv20Critical = inv20Actionable > 5;
    invariants.push({
      name: "INV-20: Actionable paid orders without payments_v2 (30d)",
      passed: inv20Actionable === 0,
      count: inv20Actionable,
      orphan: inv20Orphan,
      synthetic: inv20Synthetic,
      suppressed: inv20Suppressed,
      total: inv20Total,
      samples: inv20Samples,
      description:
        `Actionable=${inv20Actionable} (требуют admin-repair-missing-payments). ` +
        `Информационно: orphan=${inv20Orphan} (без user_id), synthetic=${inv20Synthetic} (исторические импорты), suppressed=${inv20Suppressed}. ` +
        `Total=${inv20Total} за 30д.`,
    });

    // Alert ONLY when there are actionable items — never on synthetic/orphan noise
    if (inv20Actionable > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            message:
              `${inv20Critical ? "🚨" : "⚠️"} INV-20${inv20Critical ? " CRITICAL" : ""}: ` +
              `${inv20Actionable} paid заказ(ов) без записи в payments_v2 за 30д (требуют ремонта).\n\n` +
              `Примеры: ${(inv20Samples || []).map((s: any) => s.order_number).join(", ")}\n\n` +
              `Контекст (не алерт): orphan=${inv20Orphan}, synthetic=${inv20Synthetic}, suppressed=${inv20Suppressed}, total=${inv20Total}.\n\n` +
              `Рекомендация: запустить admin-repair-missing-payments execute`,
            source: "nightly-payments-invariants",
          }),
        });
      } catch (_) {}
    }

    // -------------------------
    // INV-21: BePaid succeeded without order_id ratio (7d)
    // -------------------------
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Query 1: denom — all bepaid succeeded in 7d
    const { count: inv21Den } = await supabase
      .from("payments_v2")
      .select("id", { count: "exact", head: true })
      .eq("origin", "bepaid")
      .eq("status", "succeeded")
      .gte("created_at", sevenDaysAgo);

    // Query 2: num — bepaid succeeded without order_id in 7d
    const { count: inv21Num } = await supabase
      .from("payments_v2")
      .select("id", { count: "exact", head: true })
      .eq("origin", "bepaid")
      .eq("status", "succeeded")
      .is("order_id", null)
      .gte("created_at", sevenDaysAgo);

    const inv21NumVal = inv21Num ?? 0;
    const inv21DenVal = inv21Den ?? 0;
    const inv21Ratio = inv21DenVal > 0 ? inv21NumVal / inv21DenVal : 0;
    const inv21Passed = inv21Ratio <= 0.05;

    // Query 3: samples (up to 5) — only if there are orphans
    let inv21Samples: any[] = [];
    if (inv21NumVal > 0) {
      const { data: inv21SampleRows } = await supabase
        .from("payments_v2")
        .select("id, provider_payment_id, created_at, amount, currency")
        .eq("origin", "bepaid")
        .eq("status", "succeeded")
        .is("order_id", null)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(5);
      inv21Samples = (inv21SampleRows || []).map((r: any) => ({
        payment_id: r.id,
        provider_payment_id: r.provider_payment_id,
        created_at: r.created_at,
        amount: r.amount,
        currency: r.currency,
      }));
    }

    invariants.push({
      name: "INV-21: BePaid succeeded without order_id ratio (7d)",
      passed: inv21Passed,
      count: inv21NumVal,
      ratio: Math.round(inv21Ratio * 10000) / 100,
      denominator: inv21DenVal,
      samples: inv21Samples,
      description: `${inv21NumVal}/${inv21DenVal} (${(inv21Ratio * 100).toFixed(1)}%) успешных bePaid-платежей без order_id за 7д. Порог: 5%.`,
    });

    if (!inv21Passed) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            message: `🚨 INV-21: ${(inv21Ratio * 100).toFixed(1)}% успешных bePaid-платежей без order_id (${inv21NumVal}/${inv21DenVal}) за 7д — превышен порог 5%!`,
            source: "nightly-payments-invariants",
          }),
        });
      } catch (_) {}
    }

    // -------------------------
    // INV-22: Active subscription desync with provider (server-side JOIN via RPC)
    // -------------------------
    const { data: inv22Result, error: inv22Error } = await supabase.rpc(
      "inv22_subscription_desync",
      { p_limit: 10 }
    );

    const inv22Count = inv22Error ? -1 : (inv22Result?.count ?? 0);
    const inv22Samples = inv22Error ? [] : (inv22Result?.samples ?? []);
    const inv22Critical = inv22Count > 5;

    invariants.push({
      name: "INV-22: Active subscription desync with provider",
      passed: inv22Count === 0,
      count: inv22Count,
      samples: inv22Samples,
      description: inv22Error
        ? `Ошибка RPC inv22_subscription_desync: ${inv22Error.message}`
        : `${inv22Count} активных подписок десинхронизированы с provider_subscriptions (terminal state или пустые даты списания). ${inv22Critical ? "CRITICAL" : inv22Count > 0 ? "WARNING" : "OK"}.`,
    });

    if (inv22Count > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            message: `${inv22Critical ? "🚨" : "⚠️"} INV-22${inv22Critical ? " CRITICAL" : ""}: ${inv22Count} активных подписок десинхронизированы с provider_subscriptions!\n\nПримеры: ${inv22Samples.slice(0, 3).map((d: any) => `sub=${String(d.subscription_id).slice(0,8)}… ps_state=${d.ps_state}`).join(", ")}`,
            source: "nightly-payments-invariants",
          }),
        });
      } catch (_) {}
    }

    // Regress guard: log unknown provider/reconcile_source combos (info, not failed)
    try {
      const { data: sourceBreakdown } = await supabase.rpc('execute_readonly_query', {
        query_text: `SELECT coalesce(o.provider,'__NULL__') AS provider, coalesce(o.reconcile_source,'__NULL__') AS reconcile_source, count(*) AS cnt FROM orders_v2 o WHERE o.status = 'paid' AND o.created_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY cnt DESC LIMIT 50`
      });
      if (sourceBreakdown) {
        console.log("[nightly] INV-20 regress guard — provider/reconcile_source breakdown (30d):", JSON.stringify(sourceBreakdown));
      }
    } catch (rgErr) {
      // If the RPC doesn't exist, try a simpler approach
      console.log("[nightly] INV-20 regress guard skipped:", rgErr);
    }

    const passedCount = invariants.filter((i) => i.passed).length;
    const failedCount = invariants.filter((i) => !i.passed).length;

    return json({
      ok: failedCount === 0,
      passed: passedCount,
      failed: failedCount,
      invariants,
      duration_ms: Date.now() - startTime,
    });
  } catch (e: any) {
    console.error("[nightly-payments-invariants] Fatal error:", e);
    return json({ error: e?.message || "Unknown error", duration_ms: Date.now() - startTime }, 500);
  }
});
