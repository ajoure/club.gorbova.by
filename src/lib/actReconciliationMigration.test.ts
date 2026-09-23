import { describe, expect, it } from "vitest";

const migration = await import("../../supabase/migrations/20260923112039_cb_act_reconciliation_scenario.sql?raw");

describe("act reconciliation access migration", () => {
  it("creates a separately manageable section and grants every CB20/CB21 tariff", () => {
    expect(migration.default).toContain("ai_act_reconciliation");
    expect(migration.default).toContain("act_reconciliation");
    expect(migration.default).toContain("'section_access'");
    expect(migration.default).toContain("3e43fb28-8322-41bc-bfee-714731bdc630");
    expect(migration.default).toContain("2b7bf6d4-ad8d-46ad-9399-7f96c307c596");
    expect(migration.default).toContain("WHERE NOT EXISTS");
    expect(migration.default).not.toMatch(/UPDATE\s+public\.access_rules/i);
  });
});
