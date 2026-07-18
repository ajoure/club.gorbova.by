// TRANSIENT — controlled synthetic N=2 runtime proof for bePaid finite internal installment.
// Single POST endpoint: seeds fixtures, replays cycle 1 + cycle 2 + duplicate cycle 2 via
// the real bepaid-webhook edge function (x-internal-key + x-replay + x-replay-mode:full),
// snapshots state, cleans up, and returns a full JSON report.
//
// MUST be deleted after the proof and verified 404.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("BEPAID_WEBHOOK_INTERNAL_SECRET") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Step = { name: string; ok: boolean; details?: unknown };
const genUid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 12)}`;

async function callWebhook(body: unknown, tag: string) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/bepaid-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "x-internal-key": INTERNAL_SECRET,
      "x-replay": "1",
      "x-replay-mode": "full",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch (_) {}
  return { tag, status: resp.status, body: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!INTERNAL_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "no_internal_secret" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const steps: Step[] = [];
  const created: Record<string, string> = {};
  const runMarker = `stage3-runtime-${new Date().toISOString()}`;

  try {
    // -------- SEED --------
    const email = `proof-stage3-${crypto.randomUUID().slice(0, 8)}@fixture.local`;
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { fixture: true, run_marker: runMarker },
    });
    if (userErr || !userRes?.user) throw new Error(`createUser: ${userErr?.message}`);
    const userId = userRes.user.id;
    created.user_id = userId;
    steps.push({ name: "auth.users insert", ok: true, details: { userId, email } });

    // profile (trigger usually creates one; ensure it exists)
    await admin.from("profiles").upsert(
      {
        user_id: userId,
        email,
        full_name: "Stage3 Runtime Fixture",
        status: "active",
        meta: { test_fixture: true, run_marker: runMarker },
      },
      { onConflict: "user_id" },
    );
    const { data: profRow } = await admin
      .from("profiles").select("id").eq("user_id", userId).maybeSingle();
    created.profile_id = String(profRow?.id ?? "");

    // ephemeral product + tariff
    const productId = crypto.randomUUID();
    const productCode = `fx_prod_${productId.slice(0, 8)}`;
    const { error: prodErr } = await admin.from("products_v2").insert({
      id: productId,
      code: productCode,
      name: "Stage3 Fixture Product",
      is_active: false,
      currency: "BYN",
      status: "draft",
      meta: { test_fixture: true, run_marker: runMarker },
    });
    if (prodErr) throw new Error(`products_v2: ${prodErr.message}`);
    created.product_id = productId;

    const tariffId = crypto.randomUUID();
    const tariffCode = `fx_tariff_${tariffId.slice(0, 8)}`;
    const { error: tarErr } = await admin.from("tariffs").insert({
      id: tariffId,
      product_id: productId,
      code: tariffCode,
      name: "Stage3 Fixture Tariff",
      access_days: 30,
      trial_enabled: false,
      is_active: false,
      meta: { test_fixture: true, run_marker: runMarker },
    });
    if (tarErr) throw new Error(`tariffs: ${tarErr.message}`);
    created.tariff_id = tariffId;

    // Canonical installment block (N=2, 30d)
    const orderId = crypto.randomUUID();
    const subV2Id = crypto.randomUUID();
    const providerSubId = `bp_sub_${crypto.randomUUID().slice(0, 12)}`;
    const perPaymentByn = 100;
    const totalByn = perPaymentByn * 2;
    const installmentBlock = {
      type: "internal",
      provider: "bepaid",
      model: "bepaid_finite_subscription",
      infinite: false,
      billing_cycles: 2,
      per_payment_byn: perPaymentByn,
      effective_total_byn: totalByn,
      original_order_id: orderId,
    };

    // order
    const { error: ordErr } = await admin.from("orders_v2").insert({
      id: orderId,
      order_number: `FX-${orderId.slice(0, 8)}`,
      user_id: userId,
      product_id: productId,
      tariff_id: tariffId,
      profile_id: profRow?.id ?? null,
      base_price: totalByn,
      final_price: totalByn,
      currency: "BYN",
      status: "pending",
      is_trial: false,
      is_deleted: false,
      meta: {
        test_fixture: true,
        run_marker: runMarker,
        payment_method: "internal_installment",
        installment: installmentBlock,
      },
    });
    if (ordErr) throw new Error(`orders_v2: ${ordErr.message}`);
    created.order_id = orderId;

    // subscription
    const { error: subErr } = await admin.from("subscriptions_v2").insert({
      id: subV2Id,
      user_id: userId,
      order_id: orderId,
      product_id: productId,
      tariff_id: tariffId,
      profile_id: profRow?.id ?? null,
      status: "pending",
      is_trial: false,
      auto_renew: false,
      billing_type: "provider_managed",
      meta: {
        test_fixture: true,
        run_marker: runMarker,
        payment_method: "internal_installment",
        installment: installmentBlock,
        installment_count: 2,
        billing_cycles: 2,
      },
    });
    if (subErr) throw new Error(`subscriptions_v2: ${subErr.message}`);
    created.subscription_v2_id = subV2Id;

    // provider_subscription
    const { error: psErr } = await admin.from("provider_subscriptions").insert({
      provider: "bepaid",
      provider_subscription_id: providerSubId,
      user_id: userId,
      subscription_v2_id: subV2Id,
      order_id: orderId,
      profile_id: profRow?.id ?? null,
      state: "active",
      amount_cents: perPaymentByn * 100,
      currency: "BYN",
      interval_days: 30,
      meta: {
        test_fixture: true,
        run_marker: runMarker,
        payment_method: "internal_installment",
        installment: installmentBlock,
      },
    });
    if (psErr) throw new Error(`provider_subscriptions: ${psErr.message}`);
    created.provider_subscription_id = providerSubId;

    steps.push({ name: "seed", ok: true, details: created });

    // -------- WEBHOOK REPLAY --------
    const trackingId = `subv2:${subV2Id}:order:${orderId}`;
    const buildBody = (cycle: number, uid: string) => {
      const paidAt = new Date().toISOString();
      const activeToDays = 30 * cycle;
      const activeTo = new Date(Date.now() + activeToDays * 86400_000).toISOString();
      const renewAt = cycle >= 2 ? activeTo : new Date(Date.now() + 30 * 86400_000).toISOString();
      // Root-level state+plan → isSubscriptionWebhook=true in bepaid-webhook.
      return {
        id: providerSubId,
        state: "active",
        plan: { amount: perPaymentByn * 100, currency: "BYN" },
        tracking_id: trackingId,
        paid_billing_cycles: cycle,
        active_to: activeTo,
        renew_at: renewAt,
        card: { last_4: "4242", brand: "visa" },
        last_transaction: {
          uid,
          status: "successful",
          amount: perPaymentByn * 100,
          currency: "BYN",
          paid_at: paidAt,
          tracking_id: trackingId,
        },
      };
    };

    const uidCycle1 = genUid("tx1");
    const uidCycle2 = genUid("tx2");

    const r1 = await callWebhook(buildBody(1, uidCycle1), "cycle1");
    steps.push({ name: "webhook cycle 1", ok: r1.status < 400, details: r1 });

    const r2 = await callWebhook(buildBody(2, uidCycle2), "cycle2");
    steps.push({ name: "webhook cycle 2", ok: r2.status < 400, details: r2 });

    const r2dup = await callWebhook(buildBody(2, uidCycle2), "cycle2-duplicate");
    steps.push({ name: "webhook cycle 2 duplicate", ok: r2dup.status < 400, details: r2dup });

    // -------- SNAPSHOT --------
    const [orderRow, subRow, provRow, paymentRows, installmentRows, rebillOrders, auditRows] = await Promise.all([
      admin.from("orders_v2").select("id,status,paid_amount,meta").eq("id", orderId).maybeSingle(),
      admin.from("subscriptions_v2").select("id,status,next_charge_at,auto_renew,billing_type,meta")
        .eq("id", subV2Id).maybeSingle(),
      admin.from("provider_subscriptions").select("provider_subscription_id,state,next_charge_at,meta")
        .eq("provider_subscription_id", providerSubId).maybeSingle(),
      admin.from("payments_v2").select("id,order_id,provider,provider_payment_id,amount,status,is_recurring")
        .eq("order_id", orderId).order("created_at", { ascending: true }),
      admin.from("installment_payments").select("id").eq("order_id", orderId),
      admin.from("orders_v2").select("id,status,meta")
        .contains("meta", { rebill_parent_order_id: orderId }),
      admin.from("audit_logs")
        .select("action,meta,created_at")
        .in("action", [
          "bepaid.webhook.step_c_subscriptions_v2_update_failed",
          "bepaid.webhook.finite_internal_installment_guard_mismatch",
          "bepaid.rebill.materialization_started",
          "bepaid.installment_progress.updated",
          "bepaid.installment_progress.query_failed",
        ])
        .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const snapshot = {
      order: orderRow.data,
      subscription: subRow.data,
      provider_subscription: provRow.data,
      payments: paymentRows.data,
      installment_payments_count: installmentRows.data?.length ?? 0,
      rebill_orders_count: rebillOrders.data?.length ?? 0,
      relevant_audits: auditRows.data,
    };

    // Acceptance metrics
    const paidRows = (paymentRows.data || []).filter((p) => p.status === "succeeded");
    const uniqueUids = new Set(paidRows.map((p) => p.provider_payment_id));
    const paidTotal = paidRows.reduce((s, p) => s + Number(p.amount || 0), 0);
    const progress = (orderRow.data?.meta as any)?.installment_progress ?? null;

    const acceptance = {
      orders_v2_count: 1,
      rebill_orders_count: rebillOrders.data?.length ?? 0,
      payments_v2_count: paymentRows.data?.length ?? 0,
      unique_uid_count: uniqueUids.size,
      installment_payments_count: installmentRows.data?.length ?? 0,
      all_payments_on_original_order: (paymentRows.data || []).every((p) => p.order_id === orderId),
      subscription_status: subRow.data?.status,
      subscription_next_charge_at: subRow.data?.next_charge_at,
      provider_state: provRow.data?.state,
      paid_total_computed: paidTotal,
      installment_progress: progress,
    };

    // -------- CLEANUP --------
    const cleanup: Record<string, unknown> = {};
    cleanup.payments = await admin.from("payments_v2").delete().eq("order_id", orderId).then((r) => r.error?.message ?? "ok");
    cleanup.installments = await admin.from("installment_payments").delete().eq("order_id", orderId).then((r) => r.error?.message ?? "ok");
    cleanup.provider_sub = await admin.from("provider_subscriptions").delete().eq("provider_subscription_id", providerSubId).then((r) => r.error?.message ?? "ok");
    cleanup.subscription = await admin.from("subscriptions_v2").delete().eq("id", subV2Id).then((r) => r.error?.message ?? "ok");
    cleanup.rebill_orders = await admin.from("orders_v2").delete().contains("meta", { rebill_parent_order_id: orderId }).then((r) => r.error?.message ?? "ok");
    cleanup.order = await admin.from("orders_v2").delete().eq("id", orderId).then((r) => r.error?.message ?? "ok");
    cleanup.tariff = await admin.from("tariffs").delete().eq("id", tariffId).then((r) => r.error?.message ?? "ok");
    cleanup.product = await admin.from("products_v2").delete().eq("id", productId).then((r) => r.error?.message ?? "ok");
    // entitlements/access_grant_ledger — best-effort by user_id
    cleanup.entitlements = await admin.from("entitlements").delete().eq("user_id", userId).then((r) => r.error?.message ?? "ok");
    cleanup.access_ledger = await admin.from("access_grant_ledger").delete().eq("user_id", userId).then((r) => r.error?.message ?? "ok");
    cleanup.profile = await admin.from("profiles").delete().eq("user_id", userId).then((r) => r.error?.message ?? "ok");
    cleanup.auth_user = await admin.auth.admin.deleteUser(userId).then((r) => r.error?.message ?? "ok");

    steps.push({ name: "cleanup", ok: true, details: cleanup });

    return new Response(JSON.stringify({
      ok: true,
      run_marker: runMarker,
      created,
      tracking_id: trackingId,
      uids: { cycle1: uidCycle1, cycle2: uidCycle2 },
      snapshot,
      acceptance,
      steps,
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String((e as Error)?.message || e),
      steps,
      created,
    }, null, 2), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
