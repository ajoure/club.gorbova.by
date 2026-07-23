import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "src/hooks/admin/usePaymentIssuesSubscriptions.ts",
  "src/hooks/admin/usePaymentIssuesCounters.ts",
];

describe("payment issues subscription schema contract", () => {
  it.each(files)("does not filter subscriptions_v2 by nonexistent provider: %s", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");

    expect(source).toContain('meta->stripe->>dunning_status');
    expect(source).not.toMatch(/\.eq\("provider",\s*"stripe"\)/);
  });
});
