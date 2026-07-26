import { describe, expect, it } from "vitest";
import { getContactDisplayName, isLikelyContactName } from "./normalizeCompanyContactName";

describe("normalizeCompanyContactName", () => {
  it.each(["Иванов Иван Иванович", "Полина Асманта", "Контакт без фамилии"])("accepts person name: %s", (value) => {
    expect(isLikelyContactName(value)).toBe(true);
  });

  it.each(["+375291234567", "80291234567", "person@example.com", "tel:+375291234567", "mailto:person@example.com"])("rejects non-name value: %s", (value) => {
    expect(isLikelyContactName(value)).toBe(false);
  });

  it("uses the first valid name and falls back when none exists", () => {
    expect(getContactDisplayName("+375291234567", "person@example.com", "Иванова Анна")).toBe("Иванова Анна");
    expect(getContactDisplayName("+375291234567", "person@example.com")).toBe("Контакт без имени");
  });
});
