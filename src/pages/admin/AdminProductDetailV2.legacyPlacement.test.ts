import { describe, expect, it } from "vitest";
import source from "./AdminProductDetailV2.tsx?raw";

describe("legacy tariff-offer placement", () => {
  it("lets an existing historical slot survive an unrelated edit", () => {
    expect(source).toContain("if (isLegacyPlacement && !offerDialog.editing)");
    expect(source).toContain("metaToSave.slot_role = rawSlotRole");
    expect(source).toContain("сохранится до ручной замены");
  });

  it("gives existing offers with no stored visual variant a safe default", () => {
    expect(source).toContain('? "primary"');
    expect(source).toContain("metaToSave.site_button_variant = normalizedVariant");
  });
});
