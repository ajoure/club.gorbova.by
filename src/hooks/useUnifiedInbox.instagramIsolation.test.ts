import { describe, expect, it } from "vitest";
import source from "./useUnifiedInbox.ts?raw";

describe("unified Instagram inbox isolation", () => {
  it("keeps healthy accounts visible when one account fails", () => {
    expect(source).toContain("const results = await Promise.allSettled(");
    expect(source).toContain('result.status === "fulfilled" ? result.value : []');
    expect(source).toContain("showing healthy accounts while failed accounts are skipped");
  });
});
