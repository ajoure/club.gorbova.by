import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
import { useTriggerFullCheck } from "./useSystemHealthFullCheck";

describe("manual system check", () => {
  it("saves the report without requesting a Telegram notification", async () => {
    invoke.mockResolvedValueOnce({ data: { status: "DEGRADED" }, error: null });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useTriggerFullCheck(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await result.current.mutateAsync(); });
    expect(invoke).toHaveBeenCalledWith("system-health-full-check", { body: { source: "manual", notify: false } });
    client.clear();
  });
});
