import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260830083925_sales_manager_attribution_data.sql",
  ),
  "utf8",
);

const types = readFileSync(
  resolve(process.cwd(), "src/integrations/supabase/types.ts"),
  "utf8",
);

describe("sales manager attribution data contract", () => {
  it("keeps one versioned current assignment per payment", () => {
    expect(migration).toContain("CREATE TABLE public.payment_sales_attribution");
    expect(migration).toContain("payment_id uuid NOT NULL");
    expect(migration).toContain("order_id uuid NOT NULL");
    expect(migration).toContain("effective_from timestamptz NOT NULL DEFAULT now()");
    expect(migration).toContain("effective_to timestamptz");
    expect(migration).toContain("payment_sales_attribution_one_current_per_payment");
    expect(migration).toContain("WHERE effective_to IS NULL");
    expect(migration).toContain("batch_id uuid");
  });

  it("fails closed at the Data API boundary", () => {
    expect(migration).toContain(
      "ALTER TABLE public.payment_sales_attribution ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.payment_sales_attribution FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT SELECT ON TABLE public.payment_sales_attribution TO authenticated",
    );
    expect(migration).toContain("'sales_reports.view_all'");
    expect(migration).toContain("'sales_reports.view_own'");
    expect(migration).toContain("responsible_user_id = (SELECT auth.uid())");
    expect(migration).not.toMatch(
      /GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*payment_sales_attribution\s+TO\s+authenticated/i,
    );
  });

  it("inherits manager assignment without overwriting an active version", () => {
    expect(migration).toContain("payment_sales_attribution_inherit_v1");
    expect(migration).toContain("NEW.reference_payment_id");
    expect(migration).toContain("'refund_inheritance'");
    expect(migration).toContain("'deal_inheritance'");
    expect(migration).toContain("'unassigned'");
    expect(migration).toContain(
      "ON CONFLICT (payment_id) WHERE effective_to IS NULL DO NOTHING",
    );
    expect(migration).toContain(
      "AFTER INSERT OR UPDATE OF order_id, reference_payment_id",
    );
    expect(migration).toContain("FOR SHARE");
  });

  it("makes the transactional RPC the only authenticated reassignment path", () => {
    expect(migration).toContain("orders_v2_guard_responsible_change_v1");
    expect(migration).toContain("use_set_deal_responsible_v1");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF responsible_user_id");
    expect(migration).toContain("'forbidden_assign_self'");
    expect(migration).toContain("'forbidden_assign_other'");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_deal_responsible_v1");
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("public.has_permission(v_actor, 'deals.reassign')");
    expect(migration).toContain("public.has_role_v2(p_responsible_user_id, 'employee')");
    expect(migration).toContain("'sales_attribution.bulk_edit'");
    expect(migration).toContain("PERFORM set_config('app.sales_manager_change', 'allowed', true)");
    expect(migration).toContain("WITH RECURSIVE related_payments");
    expect(migration).toContain("refund.reference_payment_id = related.id");
  });

  it("versions payments and writes a name-snapshot audit", () => {
    expect(migration).toContain("SET effective_to = v_effective_at");
    expect(migration).toContain("interval '1 microsecond'");
    expect(migration).toContain("responsible_name_snapshot");
    expect(migration).toContain("assigned_by_name_snapshot");
    expect(migration).toContain("'deal.sales_manager_changed'");
    expect(migration).toContain("'old_responsible_name'");
    expect(migration).toContain("'new_responsible_name'");
    expect(migration).toContain("'changed_payment_count'");
    expect(migration).toContain("'batch_id'");
  });

  it("does not perform the separately gated historical backfill", () => {
    expect(migration.match(/UPDATE\s+public\.orders_v2\s+SET\s+responsible_user_id/gi)).toHaveLength(1);
    expect(migration).toContain("SET responsible_user_id = p_responsible_user_id");
    expect(migration).not.toContain("Ольга Мацкевич");
    expect(migration).not.toContain("1675");
  });

  it("publishes generated client types for the table and RPC", () => {
    expect(types).toContain("payment_sales_attribution: {");
    expect(types).toContain("set_deal_responsible_v1: {");
    expect(types).toContain("p_responsible_user_id: string | null");
  });
});
