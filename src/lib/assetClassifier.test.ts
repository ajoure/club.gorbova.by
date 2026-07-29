import { describe, expect, it } from "vitest";
import { ASSET_CLASSIFIER_CATALOG } from "../../supabase/functions/_shared/asset-classifier/catalog-161";
import { classifyAsset } from "../../supabase/functions/_shared/asset-classifier/engine";

describe("asset classifier catalog", () => {
  it("contains the complete verified legal catalog", () => {
    expect(ASSET_CLASSIFIER_CATALOG.stats).toEqual({
      sourceRows: 2248,
      finalPositions: 1900,
      hierarchyPositions: 116,
      footnotes: 97,
    });
    expect(new Set(ASSET_CLASSIFIER_CATALOG.items.map((item) => item.code)).size).toBe(1900);
  });

  it("returns an exact legal position when the user supplies a cipher", () => {
    const result = classifyAsset("Проверить шифр 48009 для ноутбука");

    expect(result.decision).toBe("recommended");
    expect(result.candidates[0]).toMatchObject({
      code: "48009",
      normativeLifeYears: 4,
    });
    expect(result.candidates[0].footnotes[0]).toMatchObject({ marker: "83" });
  });

  it("selects the notebook position without an AI call", () => {
    const result = classifyAsset(
      "Ноутбук Lenovo, портативный персональный компьютер для работы бухгалтера",
    );

    expect(result.decision).toBe("recommended");
    expect(result.candidates[0].code).toBe("48009");
    expect(result.content).toContain("постановление");
  });

  it("asks for clarification when the description is too generic", () => {
    const result = classifyAsset("оборудование");

    expect(["clarification", "not_found"]).toContain(result.decision);
    expect(result.content).toMatch(/уточн|требуется/i);
  });
});
