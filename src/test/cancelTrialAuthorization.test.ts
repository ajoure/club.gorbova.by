import { describe, expect, it } from "vitest";
import source from "../../supabase/functions/cancel-trial/index.ts?raw";

describe("cancel-trial authorization", () => {
  it("requires an authenticated owner or the exact managed service key", () => {
    expect(source).toContain("requestHasServiceRoleKey(req, supabaseKey)");
    expect(source).toContain("authClient.auth.getUser");
    expect(source).toContain("subscription.user_id !== callerUserId");
  });

  it("checks ownership before changing the subscription", () => {
    expect(source.indexOf("subscription.user_id !== callerUserId")).toBeLessThan(
      source.indexOf('.from("subscriptions_v2")\n      .update({'),
    );
  });
});
