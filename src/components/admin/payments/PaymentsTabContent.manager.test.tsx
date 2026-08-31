import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { PaymentsTabContent } from "./PaymentsTabContent";

const fixtures = vi.hoisted(() => ({
  payments: [] as UnifiedPayment[],
  directory: { data: [{ user_id: "manager-a", label: "Анна Тестовая" },
    { user_id: "manager-b", label: "Борис Тестовый" }],
  isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
  dateFilter: vi.fn(),
}));
vi.mock("@/hooks/useStaffOptions", () => ({ useStaffOptions: () => fixtures.directory }));
vi.mock("@/hooks/useUnifiedPayments", () => ({ useUnifiedPayments: (date: unknown) => {
  fixtures.dateFilter(date);
  return { payments: fixtures.payments, isLoading: false, refetch: vi.fn() };
} }));
vi.mock("@/hooks/useAdminAccess", () => ({ useAdminAccess: () => ({ canAccessResource: () => false }) }));
vi.mock("./TimezoneSelector", () => ({ TimezoneSelector: () => null,
  usePersistedTimezone: () => ({ getInitialValue: () => "Europe/Minsk", setTimezone: vi.fn() }) }));
vi.mock("./PaymentsStatsPanel", () => ({ default: ({ payments }: { payments: UnifiedPayment[] }) =>
  <div data-testid="stats-count">{payments.length}</div> }));
vi.mock("./PaymentsTable", () => ({ DEFAULT_COLUMNS: [],
  default: ({ payments }: { payments: UnifiedPayment[] }) =>
    <div data-testid="payment-rows">{payments.map(p => <span key={p.id}>{p.id}</span>)}</div> }));
vi.mock("./PaymentsBatchActions", () => ({ default: () => null }));
vi.mock("./SyncRunDialog", () => ({ default: () => null }));
vi.mock("./SyncWithStatementDialog", () => ({ default: () => null }));
vi.mock("./ManualPaymentDialog", () => ({ ManualPaymentDialog: () => null }));
// Fail closed: these UI tests must never reach a real backend.
vi.mock("@/integrations/supabase/client", () => ({ supabase: new Proxy({}, {
  get: () => { throw new Error("Unexpected backend access in payment manager UI test"); },
}) }));

const makePayment = (id: string, manager: string | null, name: string | null = null): UnifiedPayment => ({
  id, responsible_user_id: manager, responsible_name: name, amount: 10, currency: "BYN",
  status_normalized: "successful", transaction_type: "payment", paid_at: "2026-08-01T12:00:00Z",
} as UnifiedPayment);
function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = <QueryClientProvider client={queryClient}><MemoryRouter><PaymentsTabContent /></MemoryRouter></QueryClientProvider>;
  const result = render(element);
  fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
  return { rerender: () => result.rerender(element) };
}
function openManagers() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Менеджер продажи" }), { key: "ArrowDown" });
}
function choose(name: string) {
  openManagers();
  fireEvent.click(screen.getByRole("option", { name }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  fixtures.payments = [];
  fixtures.directory.data = [{ user_id: "manager-a", label: "Анна Тестовая" }, { user_id: "manager-b", label: "Борис Тестовый" }];
  Object.assign(fixtures.directory, { isLoading: false, isFetching: false, isError: false });
  fixtures.directory.refetch.mockClear();
  fixtures.dateFilter.mockClear();
});

describe("Payments: manager filter integration", () => {
  it("allows choosing a named employee even with no attributed payments", () => {
    fixtures.payments = [makePayment("unassigned", null)];
    show();
    choose("Анна Тестовая");
    expect(screen.getByRole("combobox", { name: "Менеджер продажи" })).toHaveTextContent("Анна Тестовая");
    expect(screen.getByTestId("payment-rows")).toBeEmptyDOMElement();
    expect(screen.getByText(/Нет платежей с назначением выбранному менеджеру/)).toBeInTheDocument();
    expect(screen.getByTestId("stats-count")).toHaveTextContent("0");
  });
  it("filters table and totals by payment attribution and keeps all/unassigned working", () => {
    fixtures.payments = [makePayment("first", "manager-a"), makePayment("second", "manager-b"), makePayment("unassigned", null)];
    show();
    choose("Анна Тестовая");
    expect(screen.getByTestId("payment-rows")).toHaveTextContent(/^first$/);
    expect(screen.getByTestId("stats-count")).toHaveTextContent("1");
    choose("Без менеджера");
    expect(screen.getByTestId("payment-rows")).toHaveTextContent(/^unassigned$/);
    choose("Все менеджеры");
    expect(screen.getByTestId("stats-count")).toHaveTextContent("3");
  });
  it("keeps the manager when selecting all periods and when hiding/reopening filters", () => {
    show();
    choose("Борис Тестовый");
    fireEvent.click(screen.getByRole("button", { name: "Этот месяц" }));
    const period = screen.getByRole("dialog", { name: "Период платежей и отчётов" });
    expect(period).toHaveClass("max-h-[var(--radix-popover-content-available-height)]", "overflow-y-auto");
    fireEvent.click(screen.getByRole("button", { name: "Все периоды" }));
    expect(fixtures.dateFilter).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2020-01-01", includeQueue: false }));
    fireEvent.click(screen.getByRole("button", { name: "Фильтры 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Фильтры 1" }));
    expect(screen.getByRole("combobox", { name: "Менеджер продажи" })).toHaveTextContent("Борис Тестовый");
  });
  it("shows a retryable directory error without hiding historical managers", () => {
    fixtures.directory.data = [];
    fixtures.directory.isError = true;
    fixtures.payments = [makePayment("historical", "former", "Бывший сотрудник")];
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Список может быть неполным");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку сотрудников" }));
    expect(fixtures.directory.refetch).toHaveBeenCalledOnce();
    choose("Бывший сотрудник");
    expect(screen.getByTestId("payment-rows")).toHaveTextContent("historical");
  });
  it("shows loading, keeps sentinel options usable, and uses one mobile column", () => {
    fixtures.directory.data = [];
    fixtures.directory.isLoading = true;
    show();
    expect(screen.getByText("Загружаем сотрудников…")).toBeInTheDocument();
    const field = screen.getByRole("combobox", { name: "Менеджер продажи" });
    expect(field).not.toBeDisabled();
    expect(field.parentElement?.parentElement).toHaveClass("grid-cols-1", "sm:grid-cols-2");
    openManagers();
    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["Все менеджеры", "Без менеджера"]);
  });
  it("shows an honest empty-directory state", () => {
    fixtures.directory.data = [];
    show();
    expect(screen.getByText("Сотрудники не найдены.")).toBeInTheDocument();
  });
  it("reset restores all managers without changing the period", () => {
    show();
    choose("Анна Тестовая");
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.getByRole("combobox", { name: "Менеджер продажи" })).toHaveTextContent("Все менеджеры");
    expect(screen.queryByText(/Нет платежей с назначением выбранному менеджеру/)).not.toBeInTheDocument();
  });
  it("exports all filtered payments, not only the first 50 displayed rows", async () => {
    fixtures.payments = Array.from({ length: 55 }, (_, i) => makePayment(`a-${i}`, "manager-a"))
      .concat([makePayment("other-manager", "manager-b")]);
    let csvBlob: Blob | undefined;
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => { csvBlob = blob; return "blob:test"; }), revokeObjectURL: vi.fn(),
    }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    show();
    choose("Анна Тестовая");
    expect(screen.getByTestId("payment-rows").children).toHaveLength(50);
    // The final unlabeled icon button is the existing column/export menu.
    const settings = screen.getAllByRole("button").find(button => button.querySelector(".lucide-settings"));
    expect(settings).toBeTruthy();
    fireEvent.keyDown(settings!, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Экспорт CSV" }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    const csv = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(csvBlob!);
    });
    expect(csv.split("\n").filter(line => line.startsWith('"')).length).toBe(56); // header + 55 rows
    anchorClick.mockRestore();
  });
});
