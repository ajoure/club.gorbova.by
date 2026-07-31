import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20260731072225_restore_rbac_helper_execute_grants.sql?raw";

describe("RBAC helper execution grants", () => {
  it("allows application and backend callers without exposing helpers publicly", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;",
    );
    expect(migration).toContain("TO authenticated, service_role;");
  });

  it("fails closed if the expected function signature is absent", () => {
    expect(migration).toContain("Missing required function public.has_permission(uuid,text)");
    expect(migration).toContain("Missing required function public.has_role(uuid,public.app_role)");
  });
});
