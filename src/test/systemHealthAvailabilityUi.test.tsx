import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvailabilitySummary } from "@/components/admin/system-health/AvailabilitySummary";
import { OwnerStatusHero } from "@/components/admin/system-health/owner/OwnerStatusHero";
import { useEdgeFunctionsHealth, TIER1_FUNCTIONS } from "@/hooks/useEdgeFunctionsHealth";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("truthful availability UI", () => {
  it("shows actual successful counts and incomplete legacy results, never172 healthy fallback", () => {
    render(<AvailabilitySummary report={{ edge_functions: { healthy: 172, deployed: 172, results: [
      { status: "OK" }, { status: "ERROR", error: "RateLimitError" }, { status: "CORS_ERROR" }, { status: "UNKNOWN" },
    ] } }} />);
    expect(screen.getByText(/Успешных проверок OPTIONS: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Проверка не завершена/)).toBeInTheDocument();
    expect(screen.getByText(/Лимит запросов: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/172/)).not.toBeInTheDocument();
  });
  it("shows the partial state and progress while retaining the existing action", () => {
    render(<OwnerStatusHero status="incomplete" problemsCount={0} manualReviewCount={1} onRunCheck={() => {}}
      onRefresh={() => {}} isRunning progress={{ checked: 40, total: 172 }} />);
    expect(screen.getByRole("heading", { name: "Проверка не завершена" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Проверено 40 из 172");
    expect(screen.getByRole("button", { name: "Запустить проверку" })).toBeDisabled();
  });
});
describe("legacy tech-info probes remain read-only", () => {
  it.each(["transport", "http500", "http429"])("never falls back to a business POST on %s", async variant => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe("OPTIONS");
      if (variant === "transport") throw new Error("network unavailable");
      return new Response(null, { status: variant === "http429" ? 429 : 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    const h = renderHook(useEdgeFunctionsHealth);
    let result: Awaited<ReturnType<typeof h.result.current.checkSingleFunction>>;
    await act(async () => { result = await h.result.current.checkSingleFunction(TIER1_FUNCTIONS[0].name); });
    expect(result!.status).toBe("error"); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
  });
});
