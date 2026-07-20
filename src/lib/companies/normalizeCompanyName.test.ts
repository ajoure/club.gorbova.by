import { describe, expect, it } from "vitest";
import { inferCompanyLegalForm, normalizeCompanyName } from "./normalizeCompanyName";

describe("normalizeCompanyName", () => {
  it.each([
    ["ООО \"Ромашка\"", "Ромашка", "ООО"],
    ["Ромашка ООО", "Ромашка", "ООО"],
    ["Ромашка, ООО", "Ромашка", "ООО"],
    ["«Ромашка»", "Ромашка", null],
  ])("normalizes %s", (raw, expectedName, expectedForm) => {
    expect(normalizeCompanyName(raw)).toBe(expectedName);
    expect(inferCompanyLegalForm(raw)).toBe(expectedForm);
  });

  it("supports the full shared OPF dictionary", () => {
    expect(normalizeCompanyName("РУП «Ромашка»")).toBe("Ромашка");
    expect(inferCompanyLegalForm("РУП «Ромашка»")).toBe("РУП");
    expect(normalizeCompanyName("Ромашка, СЗАО")).toBe("Ромашка");
    expect(inferCompanyLegalForm("Ромашка, СЗАО")).toBe("СЗАО");
  });
});
