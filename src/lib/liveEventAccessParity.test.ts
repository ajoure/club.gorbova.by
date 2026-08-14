import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("live event access parity", () => {
  it("applies the explicit month gate before scheduling a notification", () => {
    const source = readRepoFile(
      "supabase/functions/live-event-notifications-cron/index.ts",
    );

    expect(source).toContain(
      "select('product_id, tariff_id, conditions')",
    );
    expect(source).toContain("conditions.match_purchase_month === true");
    expect(source).toContain("await checkMonthPurchase(supabase");
    expect(source).toContain("if (!monthCheck.passed) continue");
    expect(source).toContain("const { data: tariffEnt }");
    expect(source).toContain("if (!tariffEnt) continue");
  });

  it("counts legacy profile-linked paid orders in the single-event gate", () => {
    const migration = readRepoFile(
      "supabase/migrations/20260814130836_fix_live_month_gate_profile_fallback.sql",
    );

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.has_month_purchase");
    expect(migration).toContain("p.id = o.profile_id");
    expect(migration).toContain("p.user_id = _user_id");
    expect(migration).toContain("COALESCE(o.meta->>'source', '') <> 'rule_engine'");
  });
});
