import { describe, expect, it } from "vitest";
import {
  compareCounterpartyNames,
  normalizeCounterpartyName,
} from "../../supabase/functions/_shared/bank-statement-matching";

describe("bank statement counterparty matching", () => {
  it("normalizes legal forms, quotes and Russian spelling", () => {
    expect(normalizeCounterpartyName('ООО «Алёша-Сервис»')).toBe("алеша сервис");
    expect(compareCounterpartyNames('ООО "Алеша Сервис"', "Общество с ограниченной ответственностью Алёша-Сервис")).toBe("match");
  });

  it("keeps incomplete extracted names for manual review", () => {
    expect(compareCounterpartyNames(null, "ООО Ромашка")).toBe("needs_review");
    expect(compareCounterpartyNames("ИП", "Индивидуальный предприниматель Петров Петр")).toBe("needs_review");
  });

  it("marks materially different counterparties as a mismatch", () => {
    expect(compareCounterpartyNames("ООО Белый Ветер", "ООО Северный Берег")).toBe("mismatch");
  });
});
