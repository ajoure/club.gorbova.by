import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const network = vi.hoisted(() => ({ reads: [] as Array<{ table: string; columns: string; filters: unknown[][] }>, failDeals: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator" }, role: "admin" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => false, isSuperAdmin: () => false, isAdmin: () => true, canWrite: () => true }) }));
vi.mock("@/hooks/useAdminAccess", () => ({ useAdminAccess: () => ({ canAccessSection: () => false }) }));
vi.mock("@/hooks/useAdminUsers", () => ({ useAdminUsers: () => ({ startImpersonation: vi.fn(), resetPassword: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const query = { table, columns: "", filters: [] as unknown[][] };
    const builder: Record<string, unknown> = {};
    for (const key of ["select", "eq", "in", "or", "not", "order", "range", "limit", "single", "maybeSingle", "is"]) {
      builder[key] = (...args: unknown[]) => { if (key === "select") query.columns = String(args[0]); else query.filters.push([key, ...args]); return builder; };
    }
    builder.then = (resolve: (value: unknown) => unknown) => {
      network.reads.push(query);
      const isDeals = table === "orders_v2" && query.columns.includes("payments_v2");
      const data = table === "profiles" ? { user_id: "auth-user", status: "active", telegram_user_id: null }
        : isDeals ? [{ id: "deal", status: "paid", paid_amount: 339, final_price: 339, payments_v2: [], purchase_snapshot: null }] : [];
      return Promise.resolve(resolve({ data, error: isDeals && network.failDeals ? new Error("synthetic read failure") : null }));
    };
    return builder;
  },
  rpc: async (name: string) => { network.reads.push({ table: `rpc:${name}`, columns: "", filters: [] }); return { data: [], error: null }; },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(), functions: { invoke: vi.fn() }, auth: { getUser: vi.fn() },
} }));

// Keep this test about the sheet's own reads; dialogs and independent panels
// have their own query tests and are not opened by this test.
for (const [path, name] of [
  ["DealDetailSheet", "DealDetailSheet"], ["RefundDialog", "RefundDialog"], ["AccessHistorySheet", "AccessHistorySheet"],
  ["EditContactDialog", "EditContactDialog"], ["ContactTelegramChat", "ContactTelegramChat"],
  ["EditSubscriptionDialog", "EditSubscriptionDialog"], ["EditDealDialog", "EditDealDialog"],
  ["ComposeEmailDialog", "ComposeEmailDialog"], ["AdminChargeDialog", "AdminChargeDialog"], ["AdminPaymentLinkDialog", "AdminPaymentLinkDialog"],
  ["AvatarZoomDialog", "AvatarZoomDialog"], ["LoyaltyPulse", "LoyaltyPulse"], ["ContactLoyaltyTab", "ContactLoyaltyTab"],
  ["ContactChannelsSection", "ContactChannelsSection"], ["ContactClubMembershipsList", "ContactClubMembershipsList"],
  ["contact/ContactFeedTab", "ContactFeedTab"], ["contact/WebinarActivitySection", "WebinarActivitySection"],
  ["contact/ContactArtifactsTab", "ContactArtifactsTab"], ["contact/ContactReferralsTab", "ContactReferralsTab"],
  ["ContactPaymentsTab", "ContactPaymentsTab"], ["ContactEmailHistory", "ContactEmailHistory"],
  ["tasks/CrmTasksSection", "CrmTasksSection"], ["calls/CallsHistorySection", "CallsHistorySection"],
  ["calls/CallButton", "CallButton"], ["sms/SmsButton", "SmsButton"], ["sms/SmsHistorySection", "SmsHistorySection"],
]) vi.doMock(`@/components/admin/${path}`, () => ({ [name]: () => null }));
vi.doMock("@/components/installments/ContactInstallmentsTabContent", () => ({ ContactInstallmentsTabContent: () => null }));
vi.doMock("@/components/admin/contact/ContactDealsTab", () => ({ ContactDealsTab: ({ deals }: { deals?: unknown[] }) => <div>Сделок: {deals?.length ?? "загрузка"}</div> }));

const { ContactDetailSheet } = await import("./ContactDetailSheet");
const contact = { id: "profile", user_id: "auth-user", email: null, full_name: "Synthetic", first_name: "Synthetic", last_name: null, phone: null,
  telegram_username: null, telegram_user_id: null, avatar_url: null, status: "active", created_at: "2026-01-01T12:00:00Z", last_seen_at: null, duplicate_flag: null, deals_count: 1, last_deal_at: null };
const clients: QueryClient[] = [];
const renderSheet = (open = true) => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(cache);
  const tree = (visible: boolean) => <QueryClientProvider client={cache}><MemoryRouter><ContactDetailSheet contact={contact} open={visible} onOpenChange={() => {}} /></MemoryRouter></QueryClientProvider>;
  return { ...render(tree(open)), cache, tree };
};
const selectTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
beforeEach(() => { network.reads.length = 0; network.failDeals = false; });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("contact sheet visible query scopes", () => {
  it("starts zero sheet reads when closed and defers heavy tabs on the initial profile", async () => {
    const view = renderSheet(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(network.reads).toHaveLength(0);
    view.rerender(view.tree(true));
    await waitFor(() => expect(network.reads.some((read) => read.table === "payment_methods")).toBe(true));
    const tables = network.reads.map((read) => read.table);
    for (const table of ["entitlements", "entitlement_sources", "access_rules", "company_contacts", "audit_logs", "telegram_logs", "email_logs", "consent_logs"])
      expect(tables).not.toContain(table);
    expect(network.reads.some((read) => read.columns.includes("payments_v2"))).toBe(false);
    expect(tables).toContain("provider_subscriptions"); // Visible profile card is preserved.
  });

  it("reads deals only on demand, reuses the contact cache, and stops reads when closed", async () => {
    const view = renderSheet();
    selectTab(/^Сделки/);
    await waitFor(() => expect(screen.getByText("Сделок: 1")).toBeInTheDocument());
    expect(network.reads.filter((read) => read.columns.includes("payments_v2"))).toHaveLength(1);
    expect(network.reads.some((read) => read.table === "entitlements")).toBe(false);
    selectTab(/^Профиль/);
    selectTab(/^Сделки/);
    expect(screen.getByText("Сделок: 1")).toBeInTheDocument();
    view.rerender(view.tree(false));
    await waitFor(() => expect(view.cache.isFetching()).toBe(0));
    const before = network.reads.length;
    await view.cache.invalidateQueries();
    expect(network.reads.slice(before)).toEqual([]);
  });

  it("does not display a failed deal read as an empty purchase list", async () => {
    network.failDeals = true;
    renderSheet(); selectTab(/^Сделки/);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось загрузить сделки"));
    expect(screen.queryByText("Сделок: 0")).not.toBeInTheDocument();
  });
});
