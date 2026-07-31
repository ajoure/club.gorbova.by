/**
 * Safe release smoke: authenticated checkout creation without a provider charge.
 *
 * This test is deliberately opt-in.  It never calls a real bePaid checkout,
 * never marks a payment as succeeded, and therefore must not grant paid access.
 * The expected result is one auditable `admin_test` order in `pending` state
 * and no new entitlement.  That is the production-safe proof of the test path.
 *
 * Required runner-only variables:
 *   E2E_RUN_SAFE_RELEASE=true
 *   E2E_ALLOW_PRODUCTION_TEST_DATA=true
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 *   E2E_TEST_PRODUCT_ID
 * Optional: E2E_TEST_TARIFF_CODE, VITE_SUPABASE_URL,
 *           VITE_SUPABASE_PUBLISHABLE_KEY.
 *
 * Do not add a service-role key here. The run uses the same password login and
 * JWT boundary as an administrator, then reads only rows returned by the
 * protected test call.
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "hdjgkjceownmmnrqqtuz";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E";

const enabled = process.env.E2E_RUN_SAFE_RELEASE === "true";
const productionDataAcknowledged = process.env.E2E_ALLOW_PRODUCTION_TEST_DATA === "true";
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const productId = process.env.E2E_TEST_PRODUCT_ID;
const tariffCode = process.env.E2E_TEST_TARIFF_CODE;

test.describe("safe release checkout gate", () => {
  test.skip(!enabled, "Set E2E_RUN_SAFE_RELEASE=true to run the opt-in production-safe smoke.");

  test("creates one marked test order, bypasses bePaid, and grants no paid access", async () => {
    expect(productionDataAcknowledged,
      "This run writes a clearly marked pending test order. Set E2E_ALLOW_PRODUCTION_TEST_DATA=true explicitly.").toBe(true);
    expect(adminEmail, "E2E_ADMIN_EMAIL is required").toBeTruthy();
    expect(adminPassword, "E2E_ADMIN_PASSWORD is required").toBeTruthy();
    expect(productId, "E2E_TEST_PRODUCT_ID is required").toBeTruthy();
    expect(new URL(SUPABASE_URL).hostname).toBe(`${PROJECT_REF}.supabase.co`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
      email: adminEmail!,
      password: adminPassword!,
    });
    expect(authError?.message).toBeUndefined();
    expect(auth.session).toBeTruthy();
    expect(auth.user?.email?.toLowerCase()).toBe(adminEmail!.toLowerCase());

    const userId = auth.user!.id;
    const token = auth.session!.access_token;
    const testProduct = await supabase
      .from("products_v2")
      .select("id")
      .eq("id", productId!)
      .eq("is_active", true)
      .maybeSingle();
    expect(testProduct.error?.message,
      "E2E_TEST_PRODUCT_ID must be an active products_v2 record before this test writes anything.").toBeUndefined();
    expect(testProduct.data?.id,
      "E2E_TEST_PRODUCT_ID must be an active products_v2 record before this test writes anything.").toBe(productId);
    const beforeAccess = await supabase
      .from("entitlements")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(beforeAccess.error?.message).toBeUndefined();

    const invoke = await fetch(`${SUPABASE_URL}/functions/v1/bepaid-create-token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId,
        customerEmail: adminEmail,
        tariffCode,
        isOneTime: true,
        skipRedirect: true,
      }),
    });
    const body = await invoke.json();

    expect(invoke.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ success: true, skipped: true });
    expect(body.orderId).toEqual(expect.any(String));
    expect(body.legacyOrderId).toEqual(expect.any(String));
    expect(body.isV2, "Test product must yield a marked orders_v2 row.").toBe(true);

    const { data: legacyOrder, error: legacyOrderError } = await supabase
      .from("orders")
      .select("id, status, user_id, customer_email, meta")
      .eq("id", body.legacyOrderId)
      .single();
    expect(legacyOrderError?.message).toBeUndefined();
    expect(legacyOrder).toMatchObject({
      id: body.legacyOrderId,
      status: "pending",
      user_id: userId,
      customer_email: adminEmail!.toLowerCase(),
    });

    const { data: v2Order, error: v2OrderError } = await supabase
      .from("orders_v2")
      .select("id, status, user_id, customer_email, meta")
      .eq("id", body.orderId)
      .single();
    expect(v2OrderError?.message).toBeUndefined();
    expect(v2Order).toMatchObject({
      id: body.orderId,
      status: "pending",
      user_id: userId,
      customer_email: adminEmail!.toLowerCase(),
    });
    expect((v2Order?.meta as Record<string, unknown>)?.test_payment).toBe(true);
    expect((v2Order?.meta as Record<string, unknown>)?.source).toBe("admin_test");

    const afterAccess = await supabase
      .from("entitlements")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(afterAccess.error?.message).toBeUndefined();
    expect(afterAccess.count).toBe(beforeAccess.count);

    await supabase.auth.signOut();
  });
});
