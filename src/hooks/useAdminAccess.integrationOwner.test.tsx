import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAdminAccess } from "./useAdminAccess";

const state = vi.hoisted(() => ({
  isAdmin: false,
  isSuperAdmin: false,
  gatingEnabled: true,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "synthetic-staff" } }),
}));
vi.mock("@/hooks/useRbac", () => ({ useRbac: () => state }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isLoading: false,
    data: {
      gatingEnabled: state.gatingEnabled,
      rows: [
        { section_code: "integrations", resource_code: null, access_level: "manage" },
        { section_code: "integrations", resource_code: "telegram", access_level: "manage" },
        { section_code: "payments", resource_code: null, access_level: "manage" },
        { section_code: "communication", resource_code: null, access_level: "edit" },
        { section_code: "club-members", resource_code: null, access_level: "edit" },
      ],
    },
  }),
}));

describe("integration configuration belongs only to super_admin", () => {
  beforeEach(() => Object.assign(state, { isAdmin: false, isSuperAdmin: false, gatingEnabled: true }));

  it.each([
    { isAdmin: false, gatingEnabled: true },
    { isAdmin: true, gatingEnabled: true },
    { isAdmin: false, gatingEnabled: false },
    { isAdmin: true, gatingEnabled: false },
  ])("denies even delegated manage and bypasses: %j", (settings) => {
    Object.assign(state, settings);
    const { result } = renderHook(() => useAdminAccess());
    const access = result.current;
    expect(access.getSectionLevel("integrations")).toBe("none");
    expect(access.canAccessSection("integrations")).toBe(false);
    expect(access.canAccessResource("integrations", "telegram")).toBe(false);
    for (const path of ["/admin/integrations", "/admin/integrations/email", "/admin/amocrm", "/admin/integrations/payments"]) {
      expect(access.canAccessPath(path)).toBe(false);
    }
    expect(access.canAccessPath("/admin/payments")).toBe(true);
    expect(access.canAccessPath("/admin/communication")).toBe(true);
    expect(access.canAccessPath("/admin/integrations/telegram/clubs/example/members")).toBe(true);
  });

  it("permits the verified super_admin", () => {
    state.isSuperAdmin = true;
    const { result } = renderHook(() => useAdminAccess());
    expect(result.current.canAccessSection("integrations", "manage")).toBe(true);
    expect(result.current.canAccessResource("integrations", "email", "manage")).toBe(true);
    expect(result.current.canAccessPath("/admin/integrations/telegram")).toBe(true);
  });
});
