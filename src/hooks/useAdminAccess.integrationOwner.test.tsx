import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AdminRouteGuard } from "@/components/layout/AdminRouteGuard";
import { useAdminAccess } from "./useAdminAccess";

const state = vi.hoisted(() => ({
  loading: false,
  accessLoading: false,
  isAdmin: false,
  isSuperAdmin: false,
  gatingEnabled: true,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "synthetic-staff" } }),
}));
vi.mock("@/hooks/useRbac", () => ({ useRbac: () => state }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => {
  const data = {
      get gatingEnabled() { return state.gatingEnabled; },
      rows: [
        { section_code: "integrations", resource_code: null, access_level: "manage" },
        { section_code: "integrations", resource_code: "telegram", access_level: "manage" },
        { section_code: "payments", resource_code: null, access_level: "manage" },
        { section_code: "communication", resource_code: null, access_level: "edit" },
        { section_code: "club-members", resource_code: null, access_level: "edit" },
      ],
  };
  return { useQuery: () => ({ isLoading: state.accessLoading, data }) };
});

describe("integration configuration belongs only to super_admin", () => {
  beforeEach(() => Object.assign(state, { loading: false, accessLoading: false, isAdmin: false, isSuperAdmin: false, gatingEnabled: true }));

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

function RouteProbe() {
  const location = useLocation();
  return <><output data-testid="current-path">{location.pathname}</output>
    <AdminRouteGuard><div>Protected integration settings</div></AdminRouteGuard></>;
}

describe("admin route waits for both access and canonical roles", () => {
  beforeEach(() => Object.assign(state, {
    loading: true, accessLoading: false, isAdmin: false, isSuperAdmin: false, gatingEnabled: true,
  }));

  it.each([true, false])("does not redirect while roles are pending, then resolves owner=%s", (owner) => {
    const view = render(<MemoryRouter initialEntries={["/admin/integrations/crm"]}><RouteProbe /></MemoryRouter>);
    expect(screen.getByTestId("current-path").textContent).toBe("/admin/integrations/crm");
    expect(screen.queryByText("Protected integration settings")).toBeNull();

    Object.assign(state, { loading: false, isSuperAdmin: owner });
    view.rerender(<MemoryRouter initialEntries={["/admin/integrations/crm"]}><RouteProbe /></MemoryRouter>);
    if (owner) {
      expect(screen.getByTestId("current-path").textContent).toBe("/admin/integrations/crm");
      expect(screen.getByText("Protected integration settings")).toBeTruthy();
    } else {
      expect(screen.getByTestId("current-path").textContent).not.toBe("/admin/integrations/crm");
    }
  });

  it("keeps a delegated operational section accessible after roles resolve", () => {
    const view = render(<MemoryRouter initialEntries={["/admin/communication"]}><RouteProbe /></MemoryRouter>);
    expect(screen.getByTestId("current-path").textContent).toBe("/admin/communication");
    expect(screen.queryByText("Protected integration settings")).toBeNull();
    state.loading = false;
    view.rerender(<MemoryRouter initialEntries={["/admin/communication"]}><RouteProbe /></MemoryRouter>);
    expect(screen.getByTestId("current-path").textContent).toBe("/admin/communication");
    expect(screen.getByText("Protected integration settings")).toBeTruthy();
  });

  it("releases loading when only the role loading flag changes", () => {
    const { result, rerender } = renderHook(() => useAdminAccess());
    expect(result.current.isLoading).toBe(true);
    state.loading = false;
    rerender();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.canAccessPath("/admin/integrations/crm")).toBe(false);
  });

  it("still waits for the access query when canonical roles resolve first", () => {
    Object.assign(state, { loading: false, accessLoading: true, isSuperAdmin: true });
    const { result, rerender } = renderHook(() => useAdminAccess());
    expect(result.current.isLoading).toBe(true);
    state.accessLoading = false;
    rerender();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.canAccessPath("/admin/integrations/crm")).toBe(true);
  });
});
