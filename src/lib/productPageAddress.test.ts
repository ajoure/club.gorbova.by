import { describe, expect, it } from "vitest";
import {
  normalizeProductPageSlug,
  suggestProductPageSlug,
  validateProductPageAddress,
} from "./productPageAddress";

describe("product page address", () => {
  it.each([
    ["ir", "ir"],
    ["/IR/", "ir"],
    ["https://gorbova.by/ir", "ir"],
    ["https://gorbova.by/ir?utm_source=test#tariffs", "ir"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeProductPageSlug(input)).toBe(expected);
  });

  it("rejects foreign hosts and nested paths", () => {
    expect(validateProductPageAddress("https://example.com/ir").ok).toBe(false);
    expect(validateProductPageAddress("products/ir").ok).toBe(false);
  });

  it("rejects static application routes", () => {
    expect(validateProductPageAddress("admin")).toEqual({
      ok: false,
      error: "Этот адрес зарезервирован системой",
    });
  });

  it("suggests a readable transliterated slug", () => {
    expect(suggestProductPageSlug("Идеологическая работа")).toBe("ideologicheskaya-rabota");
  });
});
