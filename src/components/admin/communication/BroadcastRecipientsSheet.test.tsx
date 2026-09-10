import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { BroadcastRecipientsSheet } from "./BroadcastRecipientsSheet";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

const users = Array.from({ length: 59 }, (_, i) => ({
  id: `recipient-${i + 1}`, full_name: `Получатель ${i + 1}`,
  email: null, telegram_username: `test_${i + 1}`, has_telegram: true, has_email: false,
}));

function view(filters: object = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })) {
  return <QueryClientProvider client={client}><Sheet open><BroadcastRecipientsSheet key={JSON.stringify(filters)} filters={filters} /></Sheet></QueryClientProvider>;
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (_name, { body }) => ({ data: {
    users: users.slice(body.page_offset, body.page_offset + body.page_limit), total_count: users.length,
    page_offset: body.page_offset, page_limit: body.page_limit,
  }, error: null }));
});

describe("recipient preview pagination", () => {
  it("lets the operator see every one of 59 recipients and return to page one", async () => {
    render(view({ include: [{ product_id: "test-product" }] }));
    expect(await screen.findByText("Получатели 1–50 из 59")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(await screen.findByText("Получатели 51–59 из 59")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("Получатель 59")).toBeInTheDocument();
    expect(screen.getByText("@test_59")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    expect(invoke).toHaveBeenLastCalledWith("broadcast-audience-preview", { body: {
      filters: { include: [{ product_id: "test-product" }] }, page_offset: 50, page_limit: 50,
    } });
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(await screen.findByText("Получатели 1–50 из 59")).toBeInTheDocument();
  });

  it("resets the page when audience filters change", async () => {
    const client = new QueryClient();
    const { rerender } = render(view({ include: ["first"] }, client));
    await screen.findByText("Получатели 1–50 из 59");
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("Получатели 51–59 из 59");
    rerender(view({ include: ["second"] }, client));
    await screen.findByText("Получатели 1–50 из 59");
    expect(invoke).toHaveBeenLastCalledWith("broadcast-audience-preview", { body: {
      filters: { include: ["second"] }, page_offset: 0, page_limit: 50,
    } });
  });

  it("shows loading and retry for a failed later page without displaying old recipients", async () => {
    render(view());
    await screen.findByText("Получатели 1–50 из 59");
    invoke.mockResolvedValue({ data: null, error: new Error("test failure") });
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.queryByText("Получатель 1")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить получателей");
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    invoke.mockResolvedValue({ data: { users: users.slice(50), total_count: 59, page_offset: 50, page_limit: 50 }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Получатель 59")).toBeInTheDocument();
  });

  it("does not claim a legacy server response is the complete list", async () => {
    invoke.mockResolvedValue({ data: { users: users.slice(0, 50), total_count: 59 }, error: null });
    render(view());
    expect(await screen.findByRole("alert")).toHaveTextContent("Полный список получателей пока недоступен");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("handles an empty audience", async () => {
    invoke.mockResolvedValue({ data: { users: [], total_count: 0, page_offset: 0, page_limit: 50 }, error: null });
    render(view());
    await waitFor(() => expect(screen.getByText("По выбранным фильтрам получателей нет.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
  });
});
