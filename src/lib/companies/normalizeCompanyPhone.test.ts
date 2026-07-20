import { describe, expect, it } from "vitest";
import { normalizeCompanyPhone } from "./normalizeCompanyPhone";

describe("normalizeCompanyPhone", () => {
  it.each([
    ["=+375 (17) 123-45-67", "+375171234567"],
    ["375291234567", "+375291234567"],
    ["80291234567", "+375291234567"],
    ["291234567", "+375291234567"],
  ])("normalizes Belarusian input %s", (input, expected) => {
    expect(normalizeCompanyPhone(input)).toBe(expected);
  });

  it("keeps a non-Belarusian E.164 number intact", () => {
    expect(normalizeCompanyPhone("+49123456789", "DE")).toBe("+49123456789");
  });
});
