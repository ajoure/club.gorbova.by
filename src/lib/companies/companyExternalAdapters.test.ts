import { describe, expect, it } from "vitest";
import {
  AmoCRMCompanyAdapter,
  CSVCompanyImportAdapter,
  normalizeCompanyExternalRows,
} from "./companyExternalAdapters";

describe("company external adapters", () => {
  it("normalizes AmoCRM payloads without leaking provider field names", () => {
    const result = new AmoCRMCompanyAdapter().normalize({
      ID: "amo-42",
      Наименование: "ООО Ромашка",
      УНП: "  123 456 789 ",
      "Рабочий email": "INFO@EXAMPLE.COM",
      "Рабочий телефон": "+375 (29) 123-45-67",
    }, 3);

    expect(result).toMatchObject({
      provider: "amocrm",
      externalId: "amo-42",
      fullName: "ООО Ромашка",
      unp: "123456789",
      email: "info@example.com",
      phone: "+375291234567",
      sourceRow: 3,
      metadata: { source: "amocrm", source_row: 3 },
    });
  });

  it("drops rows with no stable external identifier", () => {
    expect(new CSVCompanyImportAdapter().normalize({ name: "Без ID" }, 2)).toBeNull();
  });

  it("keeps source rows and filters invalid rows deterministically", () => {
    const results = normalizeCompanyExternalRows("csv", [
      { external_id: "1", name: "One" },
      { external_id: "", name: "Invalid" },
      { external_id: "2", name: "Two", unp: "not-unp" },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((row) => row.sourceRow)).toEqual([1, 3]);
    expect(results[1].unp).toBeNull();
  });
});
