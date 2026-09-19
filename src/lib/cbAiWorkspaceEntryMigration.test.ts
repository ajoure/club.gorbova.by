import { describe, expect, it } from "vitest";

const migration = await import("../../supabase/migrations/20260919190000_cb_ai_tools_workspace_entry.sql?raw");

describe("CB AI workspace entry migration contract", () => {
  it("grants the AI workspace through independently manageable tariff rules", () => {
    expect(migration.default).toContain("WHERE code = 'ai'");
    expect(migration.default).toContain("'section_access'");
    expect(migration.default).toContain("tariff_id");
    expect(migration.default).toContain("cb_ai_tools_workspace_entry");
  });

  it("does not broaden tool execution or mutate an existing rule", () => {
    expect(migration.default).toContain("сценарии проверяются отдельными rules");
    expect(migration.default).toContain("WHERE NOT EXISTS");
    expect(migration.default).not.toMatch(/UPDATE\s+public\.access_rules/i);
  });
});
