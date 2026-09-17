import { describe, expect, it } from "vitest";
import { validateBankStatementInput } from "../../supabase/functions/_shared/bank-statement-input";

const image = "data:image/png;base64,aGVsbG8=";

describe("bank statement input guard", () => {
  it("accepts a bounded supported upload", () => {
    expect(validateBankStatementInput({
      fileNames: ["statement.png"], images: [{ base64: image, filename: "statement.png", mimeType: "image/png" }], unsupportedFiles: [],
    })).toBeNull();
  });

  it("does not trust a caller that exceeds the browser file limit", () => {
    expect(validateBankStatementInput({
      fileNames: ["1.csv", "2.csv", "3.csv", "4.csv", "5.csv", "6.csv"], images: [], unsupportedFiles: [],
    })).toContain("1 до 5");
  });

  it("rejects unsupported extraction and disguised image data", () => {
    expect(validateBankStatementInput({
      fileNames: ["legacy.doc"], images: [], unsupportedFiles: [{ name: "legacy.doc", reason: "binary_doc_not_supported" }],
    })).toContain("legacy.doc");
    expect(validateBankStatementInput({
      fileNames: ["statement.html"], images: [{ base64: "data:text/html;base64,PGgxPkhlbGxvPC9oMT4=", filename: "statement.html", mimeType: "text/html" }], unsupportedFiles: [],
    })).toContain("PDF, JPG, PNG и WebP");
  });
});
