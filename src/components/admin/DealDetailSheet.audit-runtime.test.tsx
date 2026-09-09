import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DealDetailSheet } from "./DealDetailSheet";
import { formatSalesManagerAuditDetails } from "@/lib/crmDisplayLabels";

const fixture = vi.hoisted(() => ({
  logs: [] as Array<Record<string, unknown>>,
  loading: false,
  mutate: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: fixture.mutate, isPending: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "deal-audit" ? fixture.logs : undefined,
    isLoading: queryKey[0] === "deal-audit" && fixture.loading,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: fixture.from, rpc: fixture.rpc, functions: { invoke: fixture.invoke },
} }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => false, isAdmin: () => false }) }));
vi.mock("@/hooks/useStaffOptions", () => ({ useStaffOptions: () => ({ data: [] }) }));
vi.mock("@/hooks/useModuleDisplayMeta", () => ({ useModuleDisplayMeta: () => ({ data: new Map() }) }));
vi.mock("@/hooks/useLiveContactSheet", () => ({ useLiveContactSheet: () => ({ selectedContact: null, contactSheetOpen: false, setContactSheetOpen: vi.fn(), openContactSheet: vi.fn() }) }));
vi.mock("@/components/admin/ContactDetailSheet", () => ({ ContactDetailSheet: () => null }));
vi.mock("@/components/admin/contact/ContactFeedTab", () => ({ ContactFeedTab: () => null }));
vi.mock("./EditDealDialog", () => ({ EditDealDialog: () => null }));
vi.mock("./payments/LinkPaymentDialog", () => ({ LinkPaymentDialog: () => null }));
vi.mock("./GrantAccessFromDealDialog", () => ({ GrantAccessFromDealDialog: () => null }));
vi.mock("./DealPayerDocumentsCard", () => ({ DealPayerDocumentsCard: () => null }));
vi.mock("./tasks/CrmTasksSection", () => ({ CrmTasksSection: () => null }));
vi.mock("./calls/CallsHistorySection", () => ({ CallsHistorySection: () => null }));
vi.mock("./calls/CallButton", () => ({ CallButton: () => null }));
vi.mock("./sms/SmsButton", () => ({ SmsButton: () => null }));
vi.mock("./ComposeEmailDialog", () => ({ ComposeEmailDialog: () => null }));
vi.mock("@/components/payments/PaymentReceiptButton", () => ({ PaymentReceiptButton: () => null }));
vi.mock("@/components/installments/InternalInstallmentBlock", () => ({ InternalInstallmentBlock: () => null }));

const deal = {
  id: "synthetic-deal", order_number: "TEST-AUDIT", status: "pending",
  currency: "BYN", final_price: 100, created_at: "2026-09-09T10:00:00Z",
  products_v2: { name: "Тестовый продукт" }, tariffs: { name: "Тестовый тариф" },
};
const row = (id: string, action: string, meta: unknown = null) => ({
  id, action, meta, created_at: "2026-09-09T10:00:00Z", actor_type: "system",
});
const view = () => <MemoryRouter><DealDetailSheet deal={deal} profile={null} open onOpenChange={vi.fn()} /></MemoryRouter>;

describe("DealDetailSheet audit runtime", () => {
  beforeEach(() => { fixture.logs = []; fixture.loading = false; vi.clearAllMocks(); });

  it.each(["payment.success", "subscription.created", "legacy.unknown"])("opens a deal with ordinary audit event %s without crashing", action => {
    // null is intentional: the contact feed relies on it to retain ordinary event details.
    expect(formatSalesManagerAuditDetails(action, null)).toBeNull();
    fixture.logs = [row("ordinary", action)];
    expect(() => render(view())).not.toThrow();
    expect(screen.getByText("#TEST-AUDIT")).toBeInTheDocument();
    expect(fixture.mutate).not.toHaveBeenCalled();
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("keeps mixed history readable after asynchronous loading and tab changes", () => {
    fixture.loading = true;
    const result = render(view());
    fixture.loading = false;
    fixture.logs = [row("paid", "payment.success"), row("manager", "deal.sales_manager_changed", {
      old_responsible_name: "Первый менеджер", new_responsible_name: "Второй менеджер", changed_payment_count: 1,
    })];
    expect(() => result.rerender(view())).not.toThrow();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /История/ }), { button: 0, ctrlKey: false });
    expect(screen.getByText("Успешная оплата")).toBeVisible();
    expect(screen.getByText("Менеджер: Первый менеджер → Второй менеджер")).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Обзор/ }), { button: 0, ctrlKey: false });
    expect(screen.getByText("#TEST-AUDIT")).toBeVisible();
    expect(fixture.mutate).not.toHaveBeenCalled();
  });
});
