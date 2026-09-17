import { describe, expect, it } from "vitest";
import { lookupWithConcurrency } from "../../supabase/functions/_shared/bank-statement-registry";

describe("bank statement MNS lookup queue", () => {
  it("checks every value while honoring the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const values = ["a", "b", "c", "d", "e", "f", "g"];
    const result = await lookupWithConcurrency(values, 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return value.toUpperCase();
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect([...result.entries()]).toEqual(values.map((value) => [value, value.toUpperCase()]));
  });

  it("does not start a worker for an empty list", async () => {
    const result = await lookupWithConcurrency<string, string>([], 6, async () => "unexpected");
    expect(result.size).toBe(0);
  });
});
