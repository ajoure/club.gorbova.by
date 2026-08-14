import { describe, expect, it } from "vitest";
import { normalizeLiveAccessPurchaseMonths } from "./liveEventAccessMonths";

describe("live event access purchase months", () => {
  it("keeps several valid months, removes duplicates and sorts them", () => {
    expect(
      normalizeLiveAccessPurchaseMonths(
        ["2026-08", "invalid", "2026-07", "2026-08"],
        "2026-06",
      ),
    ).toEqual(["2026-07", "2026-08"]);
  });

  it("falls back to the legacy single content month", () => {
    expect(normalizeLiveAccessPurchaseMonths(undefined, "2026-07")).toEqual([
      "2026-07",
    ]);
  });

  it("does not invent a month when configuration is invalid", () => {
    expect(normalizeLiveAccessPurchaseMonths(["2026-13"], null)).toEqual([]);
  });
});
