// Stage 4 — E2E fixture reset. Idempotently rebuilds the exact fixture set.
// All writes are scoped to hard-coded fixture UUIDs. Safe to expose (anon-callable):
// it can only recreate the Stage 4 fixture rows and cannot touch any other data.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Purge derived artifacts scoped to fixture IDs.
    await admin.from("payment_tombstones").delete().in("original_payment_id", FIXTURE_PAYMENT_IDS);
    // access_grant_ledger revokes tied to fixture order.
    await admin.from("access_grant_ledger").delete().eq("order_id", FIXTURE_ORDER_ID);
    // payment_delete_operations referencing any fixture id.
    await admin.from("payment_delete_operations").delete().overlaps("target_payment_ids", FIXTURE_PAYMENT_IDS);

    // 2. Hard-delete fixture rows (bypass soft-delete: E2E harness owns them).
    await admin.from("payments_v2").delete().in("id", FIXTURE_PAYMENT_IDS);
    await admin.from("orders_v2").delete().eq("id", FIXTURE_ORDER_ID);
    await admin.from("payment_reconcile_queue").delete().eq("id", FIXTURE_QUEUE_ID);

    // 3. Recreate.
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
        provider_payment_id: "stage4-s1-bepaid", origin: "manual_admin", paid_at: new Date().toISOString(),
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S1", label: "E2E-STAGE4-S1" } },
      { id: FIXTURE_PAYMENT_IDS[3], amount: 15, currency: "BYN", status: "succeeded", provider: "bepaid",
        provider_payment_id: "stage4-s3a-bepaid", origin: "manual_admin", paid_at: new Date().toISOString(),
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S3-A", label: "E2E-STAGE4-S3-A" } },
      { id: FIXTURE_PAYMENT_IDS[4], amount: 20, currency: "BYN", status: "succeeded", provider: "stripe",
        provider_payment_id: "stage4-s3b-stripe", origin: "manual_admin", paid_at: new Date().toISOString(),
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S3-B", label: "E2E-STAGE4-S3-B" } },
      { id: FIXTURE_PAYMENT_IDS[5], amount: 12, currency: "BYN", status: "succeeded", provider: "bepaid",
        provider_payment_id: "stage4-s4-canonical", origin: "manual_admin", paid_at: new Date().toISOString(),
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S4-canonical", label: "E2E-STAGE4-S4-CANONICAL" } },
    ]);
    if (stand.error) throw stand.error;

    const orderPays = await admin.from("payments_v2").insert([
      { id: FIXTURE_PAYMENT_IDS[1], order_id: FIXTURE_ORDER_ID, amount: 25, currency: "BYN", status: "succeeded",
        provider: "bepaid", provider_payment_id: "stage4-s2-bepaid-a", origin: "manual_admin",
        paid_at: new Date().toISOString(),
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S2", label: "E2E-STAGE4-S2-A" } },
      { id: FIXTURE_PAYMENT_IDS[2], order_id: FIXTURE_ORDER_ID, amount: 25, currency: "BYN", status: "succeeded",
        provider: "stripe", provider_payment_id: "stage4-s2-stripe-b", origin: "manual_admin",
        paid_at: new Date().toISOString(),
        meta: { env: "test", fixture: "stage4_playwright", scenario: "S2", label: "E2E-STAGE4-S2-B" } },
    ]);
    if (orderPays.error) throw orderPays.error;

    const queue = await admin.from("payment_reconcile_queue").insert({
      id: FIXTURE_QUEUE_ID,
      amount: 7, currency: "BYN", provider: "manual", status: "pending",
      source: "stage4_playwright_fixture",
      raw_payload: { env: "test", fixture: "stage4_playwright", scenario: "S4-queue", label: "E2E-STAGE4-S4-QUEUE" },
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
