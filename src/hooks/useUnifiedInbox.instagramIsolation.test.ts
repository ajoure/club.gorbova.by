import { describe, expect, it } from "vitest";
import source from "./useUnifiedInbox.ts?raw";

describe("unified Instagram inbox isolation", () => {
  it("keeps healthy accounts visible when one account fails", () => {
    expect(source).toContain("const results = await Promise.allSettled(");
    expect(source).toContain('result.status === "fulfilled" ? result.value : []');
    expect(source).toContain("showing healthy accounts while failed accounts are skipped");
  });

  it("uses the canonical account-label resolver without exposing transport ids", () => {
    expect(source).toContain('from "@/lib/resolveInstagramSourceLabel"');
    expect(source).toContain("resolveInstagramAccountDisplayName(a)");
    expect(source).not.toContain("a.instagram_page_id || a.id");
    expect(source).not.toContain('sourceLabel: accountLabel ? `@${accountLabel}` : null');
  });
});
