import { describe, expect, it } from "vitest";
import grantAccessSource from "../../supabase/functions/grant-access-for-order/index.ts?raw";

describe("3DS purchase notification contract", () => {
  it("routes successful 3DS finalization through the canonical notification helper", () => {
    const start = grantAccessSource.indexOf("if (_body.context === '3ds_finalize')");
    const end = grantAccessSource.indexOf("// PATCH A: audit legacy body alias usage", start);
    const threeDsBranch = grantAccessSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(threeDsBranch).toContain("const outcome = await handleThreeDsFinalize(orderId, { supabase, audit });");
    expect(threeDsBranch).toContain("if (notifyEligible) await triggerOrderPurchasedNotification(orderId);");
    expect(threeDsBranch).toContain("'manual_review_multi_candidate'");
    expect(threeDsBranch).toContain("'skip_no_order'");
  });
});
