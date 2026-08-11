import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const subscriptionActions = readFileSync(
  resolve(process.cwd(), "supabase/functions/subscription-actions/index.ts"),
  "utf8",
);

const providerCancellationResolver = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/subscription-actions/provider_cancellation_resolver.ts",
  ),
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

const subscriptionConflict = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/subscription-conflict.ts"),
  "utf8",
);

const contactDetailSheet = readFileSync(
  resolve(process.cwd(), "src/components/admin/ContactDetailSheet.tsx"),
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
    expect(subscriptionActions).toContain("resolveProviderCancellationTargets");
    expect(subscriptionActions).toContain("provider_subscription_ids: providerSubscriptionIds");
    expect(providerCancellationResolver).toContain("provider_subscription_link_missing");
  });

  it("does not report success for an unsupported live provider", () => {
    expect(subscriptionActions).toContain("provider_cancel_not_supported");
    expect(subscriptionActions).toContain("providerResolution.outcome === 'blocked'");
  });

  it("preserves paid access end while marking bePaid renewal canceled", () => {
    expect(bepaidCancel).toContain(".select('meta, access_end_at')");
    expect(bepaidCancel).toContain("cancel_at: subV2?.access_end_at || canceledAt");
    expect(bepaidCancel).toContain("provider_canceled_local_sync_failed");
    expect(bepaidCancel).toContain("provider_canceled_provider_state_sync_failed");
    expect(bepaidCancel.indexOf("result.canceled.push(subId)")).toBeGreaterThan(
      bepaidCancel.indexOf("providerStateError"),
    );
  });

  it("blocks another checkout while a same-product provider subscription is pending", () => {
    expect(subscriptionConflict).toContain(
      "['active', 'trial', 'pending', 'past_due', 'failed_attempt']",
    );
  });

  it("does not show pending checkout attempts as active contact subscriptions", () => {
    expect(contactDetailSheet).toContain(
      "new Set(['active', 'trial'])",
    );
    expect(contactDetailSheet).toContain(
      "bePaid не подтвердил отмену подписки",
    );
    expect(contactDetailSheet).toContain(
      "queryKey: ['contact-provider-subscriptions']",
    );
  });

  it("shows an active paid entitlement when no active subscription is visible", () => {
    expect(purchasesPage).toContain('queryKey: ["user-purchase-entitlements", user?.id]');
    expect(purchasesPage).toContain('.from("entitlements")');
    expect(purchasesPage).toContain("uniqueActiveSubscriptions.length > 0 || activeEntitlements.length > 0");
    expect(purchasesPage).toContain("Оплаченный доступ");
  });
});
