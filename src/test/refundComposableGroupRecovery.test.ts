import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const subscriptionAdminActions = readFileSync(
  resolve(process.cwd(), "supabase/functions/subscription-admin-actions/index.ts"),
  "utf8",
);

describe("composable refund group recovery", () => {
  it("repairs a paid order whose group materialization is still pending", () => {
    expect(subscriptionAdminActions).toContain(
      "initialIntentError.includes('refundable_order_group_not_found')",
    );
    expect(subscriptionAdminActions).toContain("'settle_composable_order_group'");
    expect(subscriptionAdminActions).toContain(
      "({ data: intent, error: intentError } = await createComposableIntent())",
    );
  });

  it("never calls the provider before group recovery and the retried intent succeed", () => {
    const settlement = subscriptionAdminActions.indexOf(
      "'settle_composable_order_group'",
    );
    const retriedIntent = subscriptionAdminActions.indexOf(
      "({ data: intent, error: intentError } = await createComposableIntent())",
    );
    const providerCall = subscriptionAdminActions.indexOf(
      "fetch('https://gateway.bepaid.by/transactions/refunds'",
    );

    expect(settlement).toBeGreaterThan(-1);
    expect(retriedIntent).toBeGreaterThan(settlement);
    expect(providerCall).toBeGreaterThan(retriedIntent);
  });

  it("does not select a refund transaction as the parent payment", () => {
    expect(subscriptionAdminActions).toContain("p.transaction_type !== 'refund'");
  });
});
