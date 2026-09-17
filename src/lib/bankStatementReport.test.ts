import { describe, expect, it } from "vitest";
import { renderBankStatementReport } from "../../supabase/functions/_shared/bank-statement-report";

describe("bank statement report", () => {
  it("includes the complete reconciliation context for a mismatch", () => {
    const report = renderBankStatementReport([{
      date: "2026-09-17", time: "10:45", amount: "120.50", currency: "BYN",
      recipient_name: "ООО «Обычный плательщик»", recipient_unp: "123456789",
      official_name: "ИП Другой получатель", purpose: "Оплата по договору", recipient_account: "BY00TEST", source_ref: "строка 14",
      outcome: "mismatch",
    }]);

    expect(report).toContain("2026-09-17 10:45");
    expect(report).toContain("120.50 BYN");
    expect(report).toContain("123456789");
    expect(report).toContain("ИП Другой получатель");
    expect(report).toContain("Оплата по договору; BY00TEST; строка 14");
    expect(report).toContain("не вывод о нарушении");
  });

  it("keeps unavailable MNS and absent names out of mismatch count", () => {
    const report = renderBankStatementReport([
      { recipient_unp: "123456789", outcome: "unavailable" },
      { recipient_unp: "987654321", amount: 1, currency: "BYN", outcome: "needs_review" },
    ]);

    expect(report).toContain("Несовпадений: **0**");
    expect(report).toContain("Нужна ручная проверка: **1**");
    expect(report).toContain("МНС временно недоступен: **1**");
    expect(report).toContain("#### Требует ручной проверки");
  });
});
