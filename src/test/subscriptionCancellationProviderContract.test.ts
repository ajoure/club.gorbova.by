import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const subscriptionActions = readFileSync(
  resolve(process.cwd(), "supabase/functions/subscription-actions/index.ts"),
  "utf8",
);

const bepaidCancel = readFileSync(
  resolve(process.cwd(), "supabase/functions/bepaid-cancel-subscriptions/index.ts"),
  "utf8",
);

const purchasesPage = readFileSync(
  resolve(process.cwd(), "src/pages/Purchases.tsx"),
  "utf8",
);

describe("provider-backed subscription cancellation", () => {
  it("cancels bePaid before writing a local successful cancellation", () => {
    const providerCall = subscriptionActions.indexOf(
      "/functions/v1/bepaid-cancel-subscriptions",
    );
    const localCancelWrite = subscriptionActions.indexOf(
      ".from('subscriptions_v2')",
      providerCall,
    );

    expect(providerCall).toBeGreaterThan(-1);
    expect(localCancelWrite).toBeGreaterThan(providerCall);
    expect(subscriptionActions).toContain("code: 'provider_cancel_failed'");
    expect(subscriptionActions).toContain("provider_cancel_confirmed");
  });

  it("does not report success for an unsupported live provider", () => {
    expect(subscriptionActions).toContain("unsupportedLiveRows.length > 0");
    expect(subscriptionActions).toContain("code: 'provider_cancel_not_supported'");
  });

  it("preserves paid access end while marking bePaid renewal canceled", () => {
    expect(bepaidCancel).toContain(".select('meta, access_end_at')");
    expect(bepaidCancel).toContain("cancel_at: subV2?.access_end_at || canceledAt");
    expect(bepaidCancel).toContain("provider_canceled_local_sync_failed");
  });

  it("shows an active paid entitlement when no active subscription is visible", () => {
    expect(purchasesPage).toContain('queryKey: ["user-purchase-entitlements", user?.id]');
    expect(purchasesPage).toContain('.from("entitlements")');
    expect(purchasesPage).toContain("uniqueActiveSubscriptions.length > 0 || activeEntitlements.length > 0");
    expect(purchasesPage).toContain("Оплаченный доступ");
  });
});
