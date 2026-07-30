import { describe, expect, it } from "vitest";
import { isValidUnp, normalizeAndValidateUnp, normalizeUnpInput } from "./normalizeUnp";

describe("normalizeUnpInput", () => {
  it("keeps all nine digits from a formatted pasted UNP", () => {
    expect(normalizeUnpInput("591-020-810")).toBe("591020810");
    expect(normalizeAndValidateUnp(normalizeUnpInput("591 020 810"))).toBe("591020810");
  });

  it("does not retain more than the registry supports", () => {
    expect(normalizeUnpInput("59102081099")).toBe("591020810");
    expect(isValidUnp(normalizeUnpInput("59102081099"))).toBe(true);
  });
});
