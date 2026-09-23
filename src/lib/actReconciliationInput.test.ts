import { describe, expect, it } from "vitest";
import { validateActReconciliationInput } from "../../supabase/functions/_shared/act-reconciliation-input";

describe("act reconciliation input guard", () => {
  it("requires exactly two readable acts", () => {
    expect(validateActReconciliationInput({
      fileNames: ["ours.xlsx", "counterparty.pdf"],
      fileContents: "--- ours ---\noperation\n--- counterparty ---\noperation",
      images: [],
      unsupportedFiles: [],
    })).toBeNull();
    expect(validateActReconciliationInput({ fileNames: ["ours.xlsx"], fileContents: "data", images: [] })).toContain("ровно два");
  });

  it("rejects unsupported extraction instead of returning a clean result", () => {
    expect(validateActReconciliationInput({
      fileNames: ["ours.docx", "counterparty.docx"],
      fileContents: "",
      images: [],
      unsupportedFiles: [{ name: "counterparty.docx", reason: "content_not_extracted" }],
    })).toContain("counterparty.docx");
  });
});
