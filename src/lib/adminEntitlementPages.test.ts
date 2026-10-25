import { describe, expect, it, vi } from "vitest";
import { loadAdminEntitlementPages } from "./adminEntitlementPages";

describe("complete admin entitlement list", () => {
  it("includes an older customer's rights beyond the first 1,000 rows", async () => {
    const records = Array.from({ length: 1203 }, (_, i) => ({ id: String(i), owner: i === 1202 ? "older-customer" : "other" }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: records.slice(from, to + 1), count: records.length, error: null,
    }));
    const result = await loadAdminEntitlementPages(fetchPage);
    expect(result).toEqual(records);
    expect(result.filter(row => row.owner === "older-customer")).toHaveLength(1);
    expect(fetchPage.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it("continues if the server caps a page below the requested size", async () => {
    const records = Array.from({ length: 503 }, (_, i) => ({ id: String(i) }));
    const result = await loadAdminEntitlementPages(async from => ({ data: records.slice(from, from + 200), count: 503, error: null }));
    expect(result).toEqual(records);
  });

  it("rejects a later failed page instead of returning partial results", async () => {
    const failure = new Error("read failed");
    await expect(loadAdminEntitlementPages(async from => from === 0
      ? { data: [{ id: "first" }], count: 2, error: null }
      : { data: null, count: null, error: failure })).rejects.toBe(failure);
  });

  it("rejects missing rows, duplicate boundaries, and a changing count", async () => {
    for (const second of [
      { data: [], count: 2, error: null },
      { data: [{ id: "first" }], count: 2, error: null },
      { data: [{ id: "second" }], count: 3, error: null },
    ]) {
      await expect(loadAdminEntitlementPages(async from => from === 0
        ? { data: [{ id: "first" }], count: 2, error: null }
        : second)).rejects.toThrow();
    }
  });

  it("accepts a confirmed empty list but rejects an uncounted read", async () => {
    await expect(loadAdminEntitlementPages(async () => ({ data: [], count: 0, error: null }))).resolves.toEqual([]);
    await expect(loadAdminEntitlementPages(async () => ({ data: [], count: null, error: null }))).rejects.toThrow();
  });
});
