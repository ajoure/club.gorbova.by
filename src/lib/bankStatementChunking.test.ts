import { describe, expect, it } from "vitest";
import { splitBankStatementText } from "../../supabase/functions/_shared/bank-statement-chunking";

describe("bank statement text chunking", () => {
  it("keeps a short statement in one request", () => {
    expect(splitBankStatementText("header\npayment", 100)).toEqual(["header\npayment"]);
  });

  it("splits on row boundaries and preserves all content", () => {
    const chunks = splitBankStatementText("1111\n2222\n3333", 9);
    expect(chunks).toEqual(["1111\n2222", "3333"]);
    expect(chunks.join("\n")).toBe("1111\n2222\n3333");
  });
});
