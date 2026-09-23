import { describe, expect, it } from "vitest";
import { renderActReconciliationReport } from "../../supabase/functions/_shared/act-reconciliation-report";

describe("act reconciliation report", () => {
  it("shows both operations and prepares a counterparty letter", () => {
    const report = renderActReconciliationReport({
      acts_recognized: true,
      documents: [
        { file_name: "ours.xlsx", organization_name: "ООО Мы", counterparty_name: "ООО Контрагент", organization_unp: null, counterparty_unp: null, period_from: "2026-01-01", period_to: "2026-01-31", opening_balance: "0", closing_balance: "100", currency: "BYN" },
        { file_name: "their.xlsx", organization_name: "ООО Контрагент", counterparty_name: "ООО Мы", organization_unp: null, counterparty_unp: null, period_from: "2026-01-01", period_to: "2026-01-31", opening_balance: "0", closing_balance: "120", currency: "BYN" },
      ],
      matched_operations_count: 3,
      differences: [{ type: "amount_mismatch", first_date: "2026-01-15", second_date: "2026-01-15", first_document: "Акт №1", second_document: "Акт №1", first_description: "Услуги", second_description: "Услуги", first_amount: "100", second_amount: "120", currency: "BYN", explanation: "Суммы отличаются на 20 BYN" }],
      warnings: [],
    });
    expect(report).toContain("ours.xlsx");
    expect(report).toContain("their.xlsx");
    expect(report).toContain("100 BYN");
    expect(report).toContain("120 BYN");
    expect(report).toContain("Проект письма контрагенту");
    expect(report).toContain("Просим проверить акт сверки");
  });
});
