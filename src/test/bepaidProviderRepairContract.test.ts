import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const detailsSource = readFileSync(
  resolve(root, "supabase/functions/bepaid-get-subscription-details/index.ts"),
  "utf8",
);
const guardSource = readFileSync(
  resolve(
    root,
    "supabase/functions/bepaid-get-subscription-details/local_propagation_guard.ts",
  ),
  "utf8",
);
const relinkSource = readFileSync(
  resolve(
    root,
    "supabase/functions/admin-relink-bepaid-provider-subscription/index.ts",
  ),
  "utf8",
);

describe("bePaid provider repair safety", () => {
  it("blocks failed provider state before local date propagation", () => {
    expect(guardSource).toContain('decision: "blocked_provider_not_active"');
    expect(guardSource).toContain('reason: "provider_state_not_active"');
    expect(detailsSource.indexOf("classifyLocalPropagation({")).toBeLessThan(
      detailsSource.indexOf("bepaid.subscription.sync_dates"),
    );
    expect(detailsSource).toContain("providerState: normalizedState");
  });

  it("requires exact CAS tuple proof for one-row stale relink", () => {
    for (
      const field of [
        "provider_row_id",
        "expected_provider_subscription_id",
        "from_subscription_v2_id",
        "to_subscription_v2_id",
      ]
    ) {
      expect(relinkSource).toContain(field);
    }
    expect(relinkSource).toContain("active_candidate_not_unique");
    expect(relinkSource).toContain("live_provider_stream_not_unique");
    expect(relinkSource).toContain("subscription_tuple_mismatch");
    expect(relinkSource).toContain("const dryRun = body.dry_run !== false");
    expect(relinkSource).toContain('decision: "would_relink"');
    expect(relinkSource).toContain('decision: "relinked"');
    expect(relinkSource).toContain('decision: "already_relinked"');
    expect(relinkSource).toContain("protected_access_unchanged: true");
  });
});
