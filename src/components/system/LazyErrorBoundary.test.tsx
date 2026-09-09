import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LazyErrorBoundary } from "./LazyErrorBoundary";
import { reportRouteError } from "@/lib/reportRouteError";
vi.mock("@/lib/reportRouteError", () => ({ reportRouteError: vi.fn() }));
function Broken({ message }: { message: string }): never { throw new Error(message); }
beforeEach(() => { vi.mocked(reportRouteError).mockResolvedValue("not_confirmed"); vi.spyOn(console, "error").mockImplementation(() => {}); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("LazyErrorBoundary", () => {
  it("passes normal children through without sending anything", () => {
    vi.mocked(reportRouteError).mockClear(); render(<LazyErrorBoundary><span>normal</span></LazyErrorBoundary>);
    expect(screen.getByText("normal")).toBeVisible(); expect(reportRouteError).not.toHaveBeenCalled();
  });
  it("does not relabel a cooldown chunk failure as an interface bug", async () => {
    sessionStorage.setItem("__lazy_chunk_reload_ts__", String(Date.now()));
    render(<LazyErrorBoundary><Broken message="Failed to fetch dynamically imported module" /></LazyErrorBoundary>);
    expect(screen.getByRole("heading")).toHaveTextContent("Не удалось загрузить файлы страницы");
    expect(screen.queryByText("Страница не загрузилась")).not.toBeInTheDocument();
    await screen.findByText(/Автоматическая отправка не подтверждена/);
  });
  it("keeps chunk fallback usable with blocked storage", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    render(<LazyErrorBoundary><Broken message="Importing a module script failed" /></LazyErrorBoundary>);
    expect(screen.getByRole("heading")).toHaveTextContent("Не удалось загрузить файлы страницы");
    await screen.findByRole("button", { name: "Скопировать отчёт" });
  });
  it("shows saved only after acknowledgement and provides clipboard fallback", async () => {
    vi.mocked(reportRouteError).mockResolvedValue("sent");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<LazyErrorBoundary><Broken message="Maximum update depth exceeded secret@example.invalid" /></LazyErrorBoundary>);
    await screen.findByText("Технический отчёт сохранён в системном журнале.");
    fireEvent.click(screen.getByRole("button", { name: "Скопировать отчёт" }));
    const field = await screen.findByLabelText("Технический отчёт для ручного копирования");
    expect((field as HTMLTextAreaElement).value).not.toContain("secret");
    expect(screen.getByRole("heading")).toHaveTextContent("Страница не загрузилась");
  });
  it.each(["Loading chunk 1 failed", "Maximum update depth exceeded"])("never schedules a reload for %s", async message => {
    vi.useFakeTimers();
    try {
      // jsdom dispatches StorageEvents with a timer; Node's native Storage
      // does not. Use available in-memory storage, not a blocked-storage case.
      const values = new Map<string, string>();
      vi.spyOn(window, "sessionStorage", "get").mockReturnValue({
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
      } as Storage);
      const boundary = new LazyErrorBoundary({ children: null });
      vi.spyOn(boundary, "setState").mockImplementation(() => {});
      boundary.componentDidCatch(new Error(message));
      expect(vi.getTimerCount()).toBe(0);
      boundary.componentWillUnmount(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
