import { describe, expect, it } from "vitest";
import { parseBankStatementExtraction } from "../../supabase/functions/_shared/bank-statement-extraction";

describe("bank statement extraction contract", () => {
  it("requires explicit recognition and normalizes only valid UNP values", () => {
    const result = parseBankStatementExtraction(`\n\`\`\`json\n{"statement_recognized":true,"payments":[{"recipient_unp":"123 456 789","recipient_name":"ООО Тест"}]}\n\`\`\``);
    expect(result.statement_recognized).toBe(true);
    expect(result.payments).toEqual([{ recipient_unp: "123456789", recipient_name: "ООО Тест", date: null, time: null, amount: null, currency: null, purpose: null, recipient_account: null, source_ref: null }]);
  });

  it("does not treat an unrecognised document as an empty bank statement", () => {
    const result = parseBankStatementExtraction('{"statement_recognized":false,"payments":[]}');
    expect(result.statement_recognized).toBe(false);
    expect(result.payments).toEqual([]);
  });
});
