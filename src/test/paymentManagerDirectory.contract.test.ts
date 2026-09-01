import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read(
  "supabase/migrations/20260901170547_payment_manager_options_directory.sql",
);
const directoryHook = read("src/hooks/usePaymentManagerDirectoryOptions.ts");
const managerHook = read("src/hooks/usePaymentManagerOptions.ts");

describe("payment manager directory contract", () => {
  it("uses a payment-scoped, authenticated security-definer RPC", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.get_payment_manager_options_v1()",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("public.has_permission(v_actor, 'entitlements.view')");
    expect(migration).toContain("RAISE EXCEPTION 'auth_required'");
    expect(migration).toContain("RAISE EXCEPTION 'forbidden_payments_view'");
    expect(migration).toContain("FROM PUBLIC, anon");
    expect(migration).toContain("TO authenticated, service_role");
  });

  it("returns only stable IDs and labels for non-client staff", () => {
    expect(migration).toContain("RETURNS TABLE (\n  user_id uuid,\n  label text\n)");
    expect(migration).toContain("WHERE role_row.code <> 'user'");
    expect(migration).not.toMatch(/profile\.(email|phone|telegram)/);
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(INTO\s+|FROM\s+)?public\./i);
  });

  it("keeps the payment filter off the broader users.view table path", () => {
    expect(directoryHook).toContain('supabase.rpc("get_payment_manager_options_v1")');
    expect(directoryHook).not.toContain("user_roles_v2");
    expect(managerHook).toContain("usePaymentManagerDirectoryOptions()");
    expect(managerHook).not.toContain("useStaffOptions");
  });
});
