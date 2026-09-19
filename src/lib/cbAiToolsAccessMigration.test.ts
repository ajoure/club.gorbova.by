import { describe, expect, it } from "vitest";

const migration = await import("../../supabase/migrations/20260917113000_cb_ai_tools_tariff_access.sql?raw");

describe("CB AI tools access migration contract", () => {
  it("creates tariff-scoped, independently manageable rules for both tools", () => {
    expect(migration.default).toContain("'ai_asset_classifier', 'ai_bank_statement_analysis'");
    expect(migration.default).toContain("tariff_id");
    expect(migration.default).toContain("'section_access'");
    expect(migration.default).toContain("cb_ai_tools_tariff_scope_missing");
    expect(migration.default).toContain("v_cb20_tariff_count = 0 OR v_cb21_tariff_count = 0");
    expect(migration.default).not.toContain("v_tariff_count <> 10");
  });

  it("does not update or reactivate an existing access rule", () => {
    expect(migration.default).toContain("WHERE NOT EXISTS");
    expect(migration.default).not.toMatch(/UPDATE\s+public\.access_rules/i);
  });
});
