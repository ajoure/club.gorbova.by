import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260723095153_fix_referral_order_payment_trigger_polymorphic_new.sql",
  ),
  "utf8",
);

describe("referral order payment trigger migration", () => {
  it("keeps table-specific NEW fields in separate PL/pgSQL statements", () => {
    expect(migration).toContain("IF TG_TABLE_NAME = 'orders_v2' THEN");
    expect(migration).toContain(
      "PERFORM public.referral_process_order(NEW.id);",
    );
    expect(migration).toContain(
      "PERFORM public.referral_process_order(NEW.order_id);",
    );
    expect(migration).not.toMatch(/CASE\s+WHEN[\s\S]*NEW\.order_id/i);
  });
});
