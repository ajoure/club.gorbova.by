// Stage 4 — E2E fixture reset. Idempotently rebuilds the exact fixture set.
// Scoped to hard-coded fixture UUIDs. Callable only by test runners that hold
// the shared E2E_RUNNER_SECRET, verified server-side via constant-time compare.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-e2e-runner-secret",
  "Content-Type": "application/json",
};

const FIXTURE_PAYMENT_IDS = [
  "11111111-1111-4111-8111-000000000001",
  "22222222-2222-4222-8222-0000000000a1",
  "22222222-2222-4222-8222-0000000000a2",
  "33333333-3333-4333-8333-00000000000a",
  "33333333-3333-4333-8333-00000000000b",
  "44444444-4444-4444-8444-000000000001",
];
const FIXTURE_ORDER_ID = "22222222-2222-4222-8222-000000000002";
const FIXTURE_QUEUE_ID = "44444444-4444-4444-8444-0000000000f0";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth gate: only callers holding the shared runner secret.
    const expected = Deno.env.get("E2E_RUNNER_SECRET") ?? "";
    const provided = req.headers.get("x-e2e-runner-secret") ?? "";
    if (!expected || expected.length < 16 || !constantTimeEq(expected, provided)) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Purge derived artifacts scoped to fixture IDs.
    await admin.from("payment_tombstones").delete().in("original_payment_id", FIXTURE_PAYMENT_IDS);
    await admin.from("access_grant_ledger").delete().eq("order_id", FIXTURE_ORDER_ID);
    await admin.from("payment_delete_operations").delete().overlaps("target_payment_ids", FIXTURE_PAYMENT_IDS);

    // 2. Hard-delete fixture rows.
    await admin.from("payments_v2").delete().in("id", FIXTURE_PAYMENT_IDS);
    await admin.from("orders_v2").delete().eq("id", FIXTURE_ORDER_ID);
    await admin.from("payment_reconcile_queue").delete().eq("id", FIXTURE_QUEUE_ID);

    // 3. Recreate.
    const nowIso = new Date().toISOString();

    const orderInsert = await admin.from("orders_v2").insert({
      id: FIXTURE_ORDER_ID,
      order_number: "E2E-STAGE4-S2-ORDER",
      base_price: 50,
      final_price: 50,
      currency: "BYN",
      status: "paid",
      meta: { env: "test", fixture: "stage4_playwright", scenario: "S2" },
    });
    if (orderInsert.error) throw orderInsert.error;

    const stand = await admin.from("payments_v2").insert([
      { id: FIXTURE_PAYMENT_IDS[0], amount: 10, currency: "BYN", status: "succeeded", provider: "bepaid",
        provider_payment_id: "stage4-s1-bepaid", origin: "manual_admin", paid_at: nowIso,
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S1", label: "E2E-STAGE4-S1" } },
      { id: FIXTURE_PAYMENT_IDS[3], amount: 15, currency: "BYN", status: "succeeded", provider: "bepaid",
        provider_payment_id: "stage4-s3a-bepaid", origin: "manual_admin", paid_at: nowIso,
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S3-A", label: "E2E-STAGE4-S3-A" } },
      { id: FIXTURE_PAYMENT_IDS[4], amount: 20, currency: "BYN", status: "succeeded", provider: "stripe",
        provider_payment_id: "stage4-s3b-stripe", origin: "manual_admin", paid_at: nowIso,
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S3-B", label: "E2E-STAGE4-S3-B" } },
      { id: FIXTURE_PAYMENT_IDS[5], amount: 12, currency: "BYN", status: "succeeded", provider: "bepaid",
        provider_payment_id: "stage4-s4-canonical", origin: "manual_admin", paid_at: nowIso,
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S4-canonical", label: "E2E-STAGE4-S4-CANONICAL" } },
    ]);
    if (stand.error) throw stand.error;

    const orderPays = await admin.from("payments_v2").insert([
      { id: FIXTURE_PAYMENT_IDS[1], order_id: FIXTURE_ORDER_ID, amount: 25, currency: "BYN", status: "succeeded",
        provider: "bepaid", provider_payment_id: "stage4-s2-bepaid-a", origin: "manual_admin",
        paid_at: nowIso,
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S2", label: "E2E-STAGE4-S2-A" } },
      { id: FIXTURE_PAYMENT_IDS[2], order_id: FIXTURE_ORDER_ID, amount: 25, currency: "BYN", status: "succeeded",
        provider: "stripe", provider_payment_id: "stage4-s2-stripe-b", origin: "manual_admin",
        paid_at: nowIso,
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S2", label: "E2E-STAGE4-S2-B" } },
    ]);
    if (orderPays.error) throw orderPays.error;

    // S4 queue fixture — canonical shape so UnifiedPayments reader surfaces it:
    //   is_fee=false, bepaid_uid IS NOT NULL, paid_at IN window, provider=bepaid.
    // rawSource='queue' is derived downstream, so the row stays non-canonical
    // and is excluded from the delete-engine preview (mixed-selection guardrail).
    const queue = await admin.from("payment_reconcile_queue").insert({
      id: FIXTURE_QUEUE_ID,
      amount: 7,
      currency: "BYN",
      provider: "bepaid",
      bepaid_uid: "stage4-s4-queue",
      source: "webhook",
      status: "pending",
      status_normalized: "successful",
      transaction_type: "payment",
      is_fee: false,
      paid_at: nowIso,
      raw_payload: {
        env: "test",
        fixture: "stage4_playwright",
        scenario: "S4-queue",
        label: "E2E-STAGE4-S4-QUEUE",
      },
    });
    if (queue.error) throw queue.error;

    return new Response(
      JSON.stringify({
        ok: true,
        payments: FIXTURE_PAYMENT_IDS.length,
        orders: 1,
        queue: 1,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e: any) {
    console.error("[admin-e2e-reset-fixtures]", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
