import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read(
  "supabase/migrations/20260901173624_61a1bf5a-04e4-45e3-966e-e0fb484ae79e.sql",
);
const directoryHook = read("src/hooks/usePaymentManagerDirectoryOptions.ts");
const managerHook = read("src/hooks/usePaymentManagerOptions.ts");

describe("payment manager directory contract", () => {
  it("tracks only the migration version recorded by Lovable", () => {
    expect(existsSync(resolve(
      process.cwd(),
      "supabase/migrations/20260901170547_payment_manager_options_directory.sql",
    ))).toBe(false);
  });

  it("uses a payment-scoped security-definer RPC with a fail-closed auth matrix", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.get_payment_manager_options_v1()",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("coalesce((SELECT auth.role()), '') = 'service_role'");
    expect(migration).not.toContain("request.jwt.claim.role");
    expect(migration).toContain("public.has_permission(v_actor, 'entitlements.view')");
    expect(migration).toContain("RAISE EXCEPTION 'auth_required'");
    expect(migration).toContain("RAISE EXCEPTION 'forbidden_payments_view'");
    expect(migration).toContain("FROM PUBLIC, anon");
    expect(migration).toContain("TO authenticated, service_role");
  });

  it("distinguishes anonymous, permitted, forbidden and service-role callers", () => {
    expect(migration).toMatch(/IF v_actor IS NULL AND NOT v_is_service_role THEN[\s\S]*auth_required/);
    expect(migration).toMatch(/IF NOT v_is_service_role[\s\S]*entitlements\.view[\s\S]*forbidden_payments_view/);
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_payment_manager_options_v1()\n  TO authenticated, service_role");
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
