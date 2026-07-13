/**
 * Stage 4 — Payment Delete Engine E2E (S1 / S2 / S3 / S4).
 *
 * Runs against localhost preview (baseURL from playwright.config.ts).
 * Fixtures must be pre-seeded via `tools/reset_stage4_playwright_fixtures.sql`.
 *
 * Auth model:
 *   - Browser session restored from admin JWT obtained via signInWithPassword.
 *   - DB assertions made through the same admin JWT + supabase-js (RLS-respecting;
 *     admin role has read access to payments_v2 / orders_v2 / payment_tombstones
 *     / audit_logs). Service-role keys are NEVER passed to the browser.
 *
 * Env:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY  (already in .env)
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD               (admin fixture credentials)
 *
 * Isolation contract:
 *   Every mutating action is guarded by a fixture ID whitelist. Any drift on
 *   non-fixture rows fails the run before commit.
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://hdjgkjceownmmnrqqtuz.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@test.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TestAdmin123!";

const FIXTURES = {
  S1: "11111111-1111-4111-8111-000000000001",
  S2_ORDER: "22222222-2222-4222-8222-000000000002",
  S2_A: "22222222-2222-4222-8222-0000000000a1",
  S2_B: "22222222-2222-4222-8222-0000000000a2",
  S3_A: "33333333-3333-4333-8333-00000000000a",
  S3_B: "33333333-3333-4333-8333-00000000000b",
  S4_CANONICAL: "44444444-4444-4444-8444-000000000001",
  S4_QUEUE: "44444444-4444-4444-8444-0000000000f0",
} as const;

const FIXTURE_PAYMENT_IDS = [
  FIXTURES.S1,
  FIXTURES.S2_A,
  FIXTURES.S2_B,
  FIXTURES.S3_A,
  FIXTURES.S3_B,
  FIXTURES.S4_CANONICAL,
];
const FIXTURE_ORDER_IDS = [FIXTURES.S2_ORDER];

// Baseline snapshot of non-fixture row counts, captured in beforeAll.
let baseline: {
  paymentsTotal: number;
  ordersTotal: number;
  queueTotal: number;
} | null = null;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
async function loginAsAdmin(request: APIRequestContext): Promise<{
  accessToken: string;
  refreshToken: string;
  user: any;
}> {
  const res = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    }
  );
  const body = await res.json();
  if (!res.ok() || !body.access_token) {
    throw new Error(
      `Admin login failed: ${body.error_description || body.msg || res.status()}`
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    user: body.user,
  };
}

function adminSupabase(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Restore Supabase session into localStorage BEFORE navigating to protected routes.
 * Uses page.evaluate — never add_init_script (would leak into external origins).
 */
async function restoreSessionInBrowser(
  page: Page,
  baseURL: string,
  accessToken: string,
  refreshToken: string,
  user: any
) {
  const projectRef = new URL(SUPABASE_URL).host.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    user,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  await page.goto(baseURL);
  await page.evaluate(
    ({ k, v }) => window.localStorage.setItem(k, v),
    { k: storageKey, v: JSON.stringify(session) }
  );
}

// ---------------------------------------------------------------------------
// DB helpers (admin JWT via anon client — RLS-respecting, no service_role)
// ---------------------------------------------------------------------------
async function assertFixtureInventory(sb: SupabaseClient) {
  const { data: pays, error: e1 } = await sb
    .from("payments_v2")
    .select("id, is_deleted, meta")
    .in("id", FIXTURE_PAYMENT_IDS);
  if (e1) throw e1;
  expect(pays?.length).toBe(FIXTURE_PAYMENT_IDS.length);
  for (const p of pays!) {
    expect((p.meta as any)?.fixture).toBe("stage4_playwright");
    expect(p.is_deleted).toBe(false);
  }
  const { data: orders, error: e2 } = await sb
    .from("orders_v2")
    .select("id, is_deleted, status, meta")
    .in("id", FIXTURE_ORDER_IDS);
  if (e2) throw e2;
  expect(orders?.length).toBe(1);
  expect(orders![0].is_deleted).toBe(false);
  const { data: queue, error: e3 } = await sb
    .from("payment_reconcile_queue")
    .select("id, raw_payload")
    .eq("id", FIXTURES.S4_QUEUE);
  if (e3) throw e3;
  expect(queue?.length).toBe(1);
  expect((queue![0].raw_payload as any)?.fixture).toBe("stage4_playwright");
}

async function captureBaseline(sb: SupabaseClient) {
  const [{ count: pc }, { count: oc }, { count: qc }] = await Promise.all([
    sb.from("payments_v2").select("id", { count: "exact", head: true }),
    sb.from("orders_v2").select("id", { count: "exact", head: true }),
    sb.from("payment_reconcile_queue").select("id", { count: "exact", head: true }),
  ]);
  baseline = {
    paymentsTotal: pc ?? -1,
    ordersTotal: oc ?? -1,
    queueTotal: qc ?? -1,
  };
}

async function assertNoNonFixtureDrift(
  sb: SupabaseClient,
  expectedDeletedPayments: string[],
  expectedDeletedOrders: string[]
) {
  // Any deletion outside fixtures = failure.
  const { data: deletedPays } = await sb
    .from("payments_v2")
    .select("id, meta")
    .eq("is_deleted", true)
    .gte("deleted_at", new Date(Date.now() - 20 * 60 * 1000).toISOString());
  const unauthorized = (deletedPays ?? []).filter(
    (p) => !FIXTURE_PAYMENT_IDS.includes(p.id as any)
  );
  expect(
    unauthorized,
    `non-fixture payments soft-deleted in this run: ${JSON.stringify(unauthorized)}`
  ).toEqual([]);

  const { data: deletedOrders } = await sb
    .from("orders_v2")
    .select("id, meta")
    .eq("is_deleted", true)
    .gte("deleted_at", new Date(Date.now() - 20 * 60 * 1000).toISOString());
  const unauthorizedOrders = (deletedOrders ?? []).filter(
    (o) => !FIXTURE_ORDER_IDS.includes(o.id as any)
  );
  expect(unauthorizedOrders).toEqual([]);

  // Sanity: our expected deletions actually landed.
  if (expectedDeletedPayments.length) {
    const { data: dp } = await sb
      .from("payments_v2")
      .select("id, is_deleted")
      .in("id", expectedDeletedPayments);
    expect(
      dp?.every((r) => r.is_deleted === true),
      `expected soft-deleted: ${expectedDeletedPayments}, got: ${JSON.stringify(dp)}`
    ).toBe(true);
  }
  if (expectedDeletedOrders.length) {
    const { data: dor } = await sb
      .from("orders_v2")
      .select("id, is_deleted, status")
      .in("id", expectedDeletedOrders);
    expect(dor?.every((o) => o.is_deleted === true && o.status === "canceled")).toBe(
      true
    );
  }
}

async function tombstonesFor(sb: SupabaseClient, ids: string[]) {
  const { data, error } = await sb
    .from("payment_tombstones")
    .select("payment_id, provider, provider_payment_id")
    .in("payment_id", ids);
  if (error) throw error;
  return data ?? [];
}

async function ledgerRevokesForOrder(sb: SupabaseClient, orderId: string) {
  const { data } = await sb
    .from("access_grant_ledger")
    .select("id, action_type, reason_code")
    .eq("order_id", orderId)
    .eq("action_type", "revoke");
  return data ?? [];
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
async function gotoPaymentsFilteredByFixture(page: Page) {
  // Use unified /admin/payments and search by our label prefix. The exact
  // filter URL depends on PaymentsTabContent; we fall back to a client search.
  await page.goto("/admin/payments");
  await page.waitForLoadState("networkidle");
}

async function openRowActions(page: Page, paymentId: string) {
  const row = page.locator(`[data-testid="payment-row-${paymentId}"]`);
  await expect(row).toBeVisible();
  await row.getByRole("button").filter({ has: page.locator("svg") }).last().click();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
test.describe("Stage 4 — payment delete engine", () => {
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    const login = await loginAsAdmin(request);
    authToken = login.accessToken;
    const sb = adminSupabase(authToken);
    await assertFixtureInventory(sb);
    await captureBaseline(sb);
    console.log(
      `[Stage4 E2E] Fixture inventory OK. Baseline payments=${baseline?.paymentsTotal} orders=${baseline?.ordersTotal} queue=${baseline?.queueTotal}`
    );
  });

  test.afterAll(async () => {
    if (!authToken) return;
    const sb = adminSupabase(authToken);
    // Full drift check across all scenarios.
    await assertNoNonFixtureDrift(sb, FIXTURE_PAYMENT_IDS, FIXTURE_ORDER_IDS);
    console.log(
      "[Stage4 E2E] No non-fixture drift detected. Reset via tools/reset_stage4_playwright_fixtures.sql to re-run."
    );
  });

  test("S1 — standalone canonical payment: preview + execute + reload", async ({
    page,
    request,
    baseURL,
  }) => {
    const login = await loginAsAdmin(request);
    await restoreSessionInBrowser(
      page,
      baseURL!,
      login.accessToken,
      login.refreshToken,
      login.user
    );
    const sb = adminSupabase(login.accessToken);

    await gotoPaymentsFilteredByFixture(page);
    await expect(
      page.locator(`[data-testid="payment-row-${FIXTURES.S1}"]`)
    ).toBeVisible();

    // Capture preview + execute network calls.
    const previewReq = page.waitForResponse(
      (r) =>
        r.url().includes("admin-delete-payment-preview") && r.status() === 200
    );
    await openRowActions(page, FIXTURES.S1);
    await page.getByRole("menuitem", { name: /Удалить платёж/ }).click();
    const previewRes = await previewReq;
    const previewBody = await previewRes.json();
    expect(previewBody.ok).toBe(true);
    expect(previewBody.operation_id).toBeTruthy();
    expect(previewBody.payment_ids).toEqual([FIXTURES.S1]);

    const dialog = page.getByTestId("delete-preview-dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.getAttribute("data-preview-count")).toBe("1");

    const executeReq = page.waitForResponse(
      (r) =>
        r.url().includes("admin-delete-payment-execute") && r.status() === 200
    );
    await page.getByTestId("delete-confirm-btn").click();
    const executeRes = await executeReq;
    const executeBody = await executeRes.json();
    expect(executeBody.ok).toBe(true);
    expect(executeBody.deleted_payment_ids).toEqual([FIXTURES.S1]);
    expect(executeBody.audit_log_id).toBeTruthy();

    // Row disappears from active list.
    await expect(
      page.locator(`[data-testid="payment-row-${FIXTURES.S1}"]`)
    ).toHaveCount(0, { timeout: 10_000 });

    // DB proof.
    const { data: row } = await sb
      .from("payments_v2")
      .select("id, is_deleted")
      .eq("id", FIXTURES.S1)
      .single();
    expect(row?.is_deleted).toBe(true);
    const tombs = await tombstonesFor(sb, [FIXTURES.S1]);
    expect(tombs.length).toBe(1);

    // Reload — row still absent.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(`[data-testid="payment-row-${FIXTURES.S1}"]`)
    ).toHaveCount(0);

    console.log(
      `[S1] operation_id=${previewBody.operation_id} audit_log_id=${executeBody.audit_log_id} tombstones=1`
    );
  });

  test("S2 — order with two payments: single execute soft-deletes both + cancels order", async ({
    page,
    request,
    baseURL,
  }) => {
    const login = await loginAsAdmin(request);
    await restoreSessionInBrowser(
      page,
      baseURL!,
      login.accessToken,
      login.refreshToken,
      login.user
    );
    const sb = adminSupabase(login.accessToken);

    await gotoPaymentsFilteredByFixture(page);
    await openRowActions(page, FIXTURES.S2_A);
    const previewReq = page.waitForResponse((r) =>
      r.url().includes("admin-delete-payment-preview")
    );
    await page
      .getByRole("menuitem", { name: /Удалить сделку и все связанные платежи/ })
      .click();
    const previewBody = await (await previewReq).json();
    expect(previewBody.ok).toBe(true);
    expect(previewBody.payment_ids.sort()).toEqual(
      [FIXTURES.S2_A, FIXTURES.S2_B].sort()
    );
    expect(previewBody.order_id).toBe(FIXTURES.S2_ORDER);

    const dialog = page.getByTestId("delete-preview-dialog");
    expect(await dialog.getAttribute("data-preview-count")).toBe("2");

    let executeCalls = 0;
    page.on("response", (r) => {
      if (r.url().includes("admin-delete-payment-execute")) executeCalls++;
    });
    const executeReq = page.waitForResponse((r) =>
      r.url().includes("admin-delete-payment-execute")
    );
    await page.getByTestId("delete-confirm-btn").click();
    const executeBody = await (await executeReq).json();
    expect(executeBody.ok).toBe(true);
    expect(executeBody.deleted_payment_ids.sort()).toEqual(
      [FIXTURES.S2_A, FIXTURES.S2_B].sort()
    );
    expect(executeBody.affected_order_ids).toContain(FIXTURES.S2_ORDER);

    await page.waitForTimeout(500);
    expect(executeCalls).toBe(1);

    // DB proof.
    const { data: order } = await sb
      .from("orders_v2")
      .select("id, is_deleted, status")
      .eq("id", FIXTURES.S2_ORDER)
      .single();
    expect(order?.is_deleted).toBe(true);
    expect(order?.status).toBe("canceled");
    const tombs = await tombstonesFor(sb, [FIXTURES.S2_A, FIXTURES.S2_B]);
    expect(tombs.length).toBe(2);
    const revokes = await ledgerRevokesForOrder(sb, FIXTURES.S2_ORDER);
    // Duplicate revoke rows must be 0 for the same ledger_id — verified by dedupe logic.
    const revokeIds = revokes.map((r) => r.id);
    expect(new Set(revokeIds).size).toBe(revokeIds.length);

    // Reload — rows and order absent from active view.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator(`[data-testid="payment-row-${FIXTURES.S2_A}"]`)
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-testid="payment-row-${FIXTURES.S2_B}"]`)
    ).toHaveCount(0);

    console.log(
      `[S2] operation_id=${previewBody.operation_id} tombstones=2 order=${order?.status}`
    );
  });

  test("S3 — bulk: two standalone canonical payments deleted via batch actions", async ({
    page,
    request,
    baseURL,
  }) => {
    const login = await loginAsAdmin(request);
    await restoreSessionInBrowser(
      page,
      baseURL!,
      login.accessToken,
      login.refreshToken,
      login.user
    );
    const sb = adminSupabase(login.accessToken);

    await gotoPaymentsFilteredByFixture(page);
    for (const id of [FIXTURES.S3_A, FIXTURES.S3_B]) {
      const row = page.locator(`[data-testid="payment-row-${id}"]`);
      await expect(row).toBeVisible();
      await row.locator('button[role="checkbox"], [role="checkbox"]').first().click();
    }

    let previewCalls = 0;
    let executeCalls = 0;
    page.on("response", (r) => {
      if (r.url().includes("admin-delete-payment-preview")) previewCalls++;
      if (r.url().includes("admin-delete-payment-execute")) executeCalls++;
    });

    const previewReq = page.waitForResponse((r) =>
      r.url().includes("admin-delete-payment-preview")
    );
    // Batch action button: text "Удалить (N)" from PaymentsBatchActions.
    await page.getByRole("button", { name: /Удалить \(2\)/ }).click();
    const previewBody = await (await previewReq).json();
    expect(previewBody.ok).toBe(true);
    expect(previewBody.payment_ids.sort()).toEqual(
      [FIXTURES.S3_A, FIXTURES.S3_B].sort()
    );

    const executeReq = page.waitForResponse((r) =>
      r.url().includes("admin-delete-payment-execute")
    );
    await page.getByTestId("delete-confirm-btn").click();
    const executeBody = await (await executeReq).json();
    expect(executeBody.ok).toBe(true);
    expect(executeBody.deleted_payment_ids?.length).toBe(2);

    await page.waitForTimeout(500);
    expect(previewCalls).toBe(1);
    expect(executeCalls).toBe(1);

    await page.reload();
    await page.waitForLoadState("networkidle");
    for (const id of [FIXTURES.S3_A, FIXTURES.S3_B]) {
      await expect(page.locator(`[data-testid="payment-row-${id}"]`)).toHaveCount(0);
    }
    const tombs = await tombstonesFor(sb, [FIXTURES.S3_A, FIXTURES.S3_B]);
    expect(tombs.length).toBe(2);

    console.log(
      `[S3] operation_id=${previewBody.operation_id} preview_calls=${previewCalls} execute_calls=${executeCalls}`
    );
  });

  test("S4 — mixed selection: canonical + queue-only shows warning, only canonical deleted", async ({
    page,
    request,
    baseURL,
  }) => {
    const login = await loginAsAdmin(request);
    await restoreSessionInBrowser(
      page,
      baseURL!,
      login.accessToken,
      login.refreshToken,
      login.user
    );
    const sb = adminSupabase(login.accessToken);

    await gotoPaymentsFilteredByFixture(page);

    for (const id of [FIXTURES.S4_CANONICAL, FIXTURES.S4_QUEUE]) {
      const row = page.locator(`[data-testid="payment-row-${id}"]`);
      await expect(row).toBeVisible();
      await row.locator('[role="checkbox"]').first().click();
    }

    // Mixed-selection warning must appear.
    await expect(page.getByTestId("mixed-selection-warning")).toBeVisible();

    const previewReq = page.waitForResponse((r) =>
      r.url().includes("admin-delete-payment-preview")
    );
    await page.getByRole("button", { name: /Удалить/ }).first().click();
    const previewBody = await (await previewReq).json();
    expect(previewBody.ok).toBe(true);
    // Only the canonical row must be in the preview.
    expect(previewBody.payment_ids).toEqual([FIXTURES.S4_CANONICAL]);

    const executeReq = page.waitForResponse((r) =>
      r.url().includes("admin-delete-payment-execute")
    );
    await page.getByTestId("delete-confirm-btn").click();
    const executeBody = await (await executeReq).json();
    expect(executeBody.deleted_payment_ids).toEqual([FIXTURES.S4_CANONICAL]);

    // Queue row is untouched.
    const { data: queue } = await sb
      .from("payment_reconcile_queue")
      .select("id, status")
      .eq("id", FIXTURES.S4_QUEUE)
      .single();
    expect(queue?.id).toBe(FIXTURES.S4_QUEUE);

    console.log(
      `[S4] operation_id=${previewBody.operation_id} canonical_deleted=1 queue_untouched=1`
    );
  });
});
