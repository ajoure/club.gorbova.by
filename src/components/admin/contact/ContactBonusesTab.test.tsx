import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContactBonusesTab } from "./ContactBonusesTab";
const net = vi.hoisted(() => ({ rpc: vi.fn(), admin: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator" } }) }));
vi.mock("@/hooks/useAdminAccess", () => ({ useAdminAccess: () => ({ isAdmin: net.admin, isSuperAdmin: false, isLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: net.rpc } }));
const basic = { available_minor: 0, currency: "BYN", entries: [], payments: [{ id: "payment", amount_minor: 150000, product_name: "Synthetic consultation", paid_at: "2026-09-17T08:47:00Z", already_credited: false }], request: null };
const clients: QueryClient[] = [];
function view(profile = "profile") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><ContactBonusesTab key={profile} profileId={profile} contactName="Synthetic contact" /></QueryClientProvider>);
}
async function prepare() {
  await screen.findByLabelText("Сумма бонуса, BYN");
  fireEvent.change(screen.getByLabelText("Сумма бонуса, BYN"), { target: { value: "150,00" } });
  fireEvent.change(screen.getByLabelText("Основание начисления"), { target: { value: "Consultation 10%" } });
  fireEvent.change(screen.getByLabelText("Платёж-основание"), { target: { value: "payment" } });
  fireEvent.click(screen.getByRole("button", { name: "Начислить бонус" }));
  await screen.findByRole("dialog");
}
beforeEach(() => { localStorage.clear(); net.admin = true; net.rpc.mockReset(); net.rpc.mockResolvedValue({ data: basic, error: null }); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });
const writes = () => net.rpc.mock.calls.filter(([name]) => name === "admin_credit_customer_bonus");

describe("manual bonus contact form", () => {
  it("does not read or expose the bonus controls for a non-administrator", async () => {
    net.admin = false; view();
    expect(screen.queryByRole("button", { name: "Начислить бонус" })).toBeNull();
    expect(net.rpc).not.toHaveBeenCalled();
  });
  it("writes only after recipient/amount confirmation and verifies the same entry", async () => {
    let args: Record<string, unknown> | undefined;
    net.rpc.mockImplementation(async (name, input) => {
      if (name === "admin_credit_customer_bonus") { args = input; return { data: { entry_id: "entry", created: true }, error: null }; }
      if (input?.p_request_id) return { data: { ...basic, request: { entry_id: "entry", profile_id: input.p_profile_id, amount_minor: args?.p_amount_minor, reason: args?.p_reason, source_payment_id: args?.p_source_payment_id, status: "posted" } }, error: null };
      return { data: basic, error: null };
    });
    view(); await prepare(); expect(writes()).toHaveLength(0);
    expect(screen.getByRole("dialog").textContent).toContain("Synthetic contact");
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить начисление" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toHaveLength(1);
    expect(args).toMatchObject({ p_profile_id: "profile", p_amount_minor: 15000, p_reason: "Consultation 10%", p_source_payment_id: "payment" });
    expect(localStorage.getItem("customer-bonus-pending:operator:profile")).toBeNull();
  });
  it("keeps an uncertain operation after remount and only reads when reconciling", async () => {
    net.rpc.mockImplementation(async (name) => name === "admin_credit_customer_bonus"
      ? { data: null, error: { message: "network timeout", code: "" } } : { data: basic, error: null });
    const first = view(); await prepare();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить начисление" }));
    await screen.findByRole("button", { name: "Проверить результат" });
    const saved = localStorage.getItem("customer-bonus-pending:operator:profile"); expect(saved).toBeTruthy();
    first.unmount(); view(); await screen.findByRole("button", { name: "Проверить результат" });
    expect(screen.queryByLabelText("Сумма бонуса, BYN")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Проверить результат" }));
    await screen.findByText(/Запись начисления пока не подтверждена/);
    expect(writes()).toHaveLength(1); expect(localStorage.getItem("customer-bonus-pending:operator:profile")).toBe(saved);
  });
  it("reconciles a previously uncertain success without another credit", async () => {
    const saved = { requestId: "request", profileId: "profile", amountMinor: 15000, reason: "reason", paymentId: "payment" };
    localStorage.setItem("customer-bonus-pending:operator:profile", JSON.stringify(saved));
    net.rpc.mockImplementation(async (_name, input) => ({ data: input?.p_request_id ? { ...basic, request: { entry_id: "entry", profile_id: "profile", amount_minor: 15000, reason: "reason", source_payment_id: "payment", status: "posted" } } : basic, error: null }));
    view(); fireEvent.click(await screen.findByRole("button", { name: "Проверить результат" }));
    await screen.findByLabelText("Сумма бонуса, BYN");
    expect(writes()).toHaveLength(0); expect(localStorage.getItem("customer-bonus-pending:operator:profile")).toBeNull();
  });
  it("blocks malformed saved requests and keeps them for manual reconciliation", async () => {
    localStorage.setItem("customer-bonus-pending:operator:profile", "broken"); view();
    await screen.findByText(/Не удалось прочитать сохранённую операцию/);
    expect(screen.queryByLabelText("Сумма бонуса, BYN")).toBeNull();
    expect(localStorage.getItem("customer-bonus-pending:operator:profile")).toBe("broken"); expect(writes()).toHaveLength(0);
  });
  it("does not submit invalid decimals or an already credited receipt", async () => {
    net.rpc.mockResolvedValue({ data: { ...basic, payments: [{ ...basic.payments[0], already_credited: true }] }, error: null });
    view(); await screen.findByLabelText("Сумма бонуса, BYN");
    fireEvent.change(screen.getByLabelText("Сумма бонуса, BYN"), { target: { value: "150.001" } });
    fireEvent.change(screen.getByLabelText("Основание начисления"), { target: { value: "reason" } });
    expect(screen.getByRole("button", { name: "Начислить бонус" })).toBeDisabled();
    expect(screen.getByRole("option", { name: /уже начислено/ })).toBeDisabled(); expect(writes()).toHaveLength(0);
  });
});
