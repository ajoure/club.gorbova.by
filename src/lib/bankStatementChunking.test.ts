import { describe, expect, it } from "vitest";
import { batchBankStatementImages, splitBankStatementText } from "../../supabase/functions/_shared/bank-statement-chunking";

describe("bank statement text chunking", () => {
  it("keeps a short statement in one request", () => {
    expect(splitBankStatementText("header\npayment", 100)).toEqual(["header\npayment"]);
  });

  it("splits on row boundaries and preserves all content", () => {
    const chunks = splitBankStatementText("1111\n2222\n3333", 9);
    expect(chunks).toEqual(["1111\n2222", "3333"]);
    expect(chunks.join("\n")).toBe("1111\n2222\n3333");
  });

  it("accepts statements larger than the former 120k limit", () => {
    const text = Array.from({ length: 4 }, (_, index) => `${index}:${"x".repeat(39_990)}`).join("\n");
    const chunks = splitBankStatementText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join("\n")).toBe(text);
  });

  it("batches scanned pages into small vision requests", () => {
    expect(batchBankStatementImages([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4], [5]]);
  });
});
