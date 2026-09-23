import { describe, expect, it } from "vitest";
import { parseActReconciliationExtraction } from "../../supabase/functions/_shared/act-reconciliation-extraction";

describe("act reconciliation extraction contract", () => {
  it("normalizes two documents and accepted differences", () => {
    const result = parseActReconciliationExtraction(`\`\`\`json
      {"acts_recognized":true,"documents":[{"file_name":"ours.xlsx","organization_unp":"123 456 789"},{"file_name":"their.xlsx"}],"matched_operations_count":4,"differences":[{"type":"amount_mismatch","first_amount":"100.00","second_amount":"120.00","explanation":"Суммы различаются"}],"warnings":[]}
    \`\`\``);
    expect(result.acts_recognized).toBe(true);
    expect(result.documents[0].organization_unp).toBe("123456789");
    expect(result.matched_operations_count).toBe(4);
    expect(result.differences).toHaveLength(1);
  });

  it("does not accept one generic document as a two-act reconciliation", () => {
    const result = parseActReconciliationExtraction('{"acts_recognized":true,"documents":[{"file_name":"one.pdf"}],"differences":[]}');
    expect(result.acts_recognized).toBe(false);
    expect(result.documents).toEqual([]);
  });
});
