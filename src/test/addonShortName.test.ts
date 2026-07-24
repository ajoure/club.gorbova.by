import { describe, it, expect } from "vitest";
import { getAddonShortName, getAddonSecondaryLine } from "@/lib/addonShortName";

describe("getAddonShortName", () => {
  it("strips full CB prefix and 'Модуль:'", () => {
    expect(
      getAddonShortName("Ценный бухгалтер | 1 ступень 2.0 | Модуль: Строительство"),
    ).toBe("Строительство");
  });

  it("handles 'Модуль ' without colon", () => {
    expect(getAddonShortName("Ценный бухгалтер | Модуль Маркетплейсы")).toBe("Маркетплейсы");
  });

  it("returns single-segment names unchanged", () => {
    expect(getAddonShortName("Посредничество")).toBe("Посредничество");
  });

  it("handles empty / null", () => {
    expect(getAddonShortName("")).toBe("");
    expect(getAddonShortName(null)).toBe("");
    expect(getAddonShortName(undefined)).toBe("");
  });

  it("falls back to tail when strip empties the string", () => {
    expect(getAddonShortName("A | Модуль:")).toBe("Модуль:");
  });

  it("trims surrounding whitespace and pipes", () => {
    expect(getAddonShortName("  Родитель  |  Модуль:  Учёт у ИП  ")).toBe("Учёт у ИП");
  });
});

describe("getAddonSecondaryLine", () => {
  it("returns null when tariff equals short name", () => {
    expect(getAddonSecondaryLine("Строительство", "Строительство")).toBeNull();
  });

  it("returns tariff when it adds info", () => {
    expect(getAddonSecondaryLine("1 ступень 2.0", "Строительство")).toBe("1 ступень 2.0");
  });

  it("returns null for empty tariff", () => {
    expect(getAddonSecondaryLine("", "Строительство")).toBeNull();
    expect(getAddonSecondaryLine(null, "Строительство")).toBeNull();
  });
});
