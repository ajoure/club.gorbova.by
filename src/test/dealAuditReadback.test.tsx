import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAudit: vi.fn(),
  readProfiles: vi.fn(),
  auditFilter: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "audit_logs") {
        const query = {
          select: () => query,
          or: (filter: string) => { mocks.auditFilter(filter); return query; },
          order: () => query,
          limit: () => mocks.readAudit(),
        };
        return query;
      }
      return { select: () => ({ in: () => mocks.readProfiles() }) };
    },
  },
}));

import { getDealAuditErrorCode, useDealAuditLogs } from "@/hooks/useDealAuditLogs";

const clients: QueryClient[] = [];
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAudit.mockResolvedValue({ data: [], error: null });
  mocks.readProfiles.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("deal audit read-back", () => {
  it("does not prefetch an unopened history tab", () => {
    const { wrapper } = harness();
    renderHook(() => useDealAuditLogs("deal-1", false), { wrapper });
    expect(mocks.readAudit).not.toHaveBeenCalled();
  });

  it("preserves the canonical entity ID and legacy metadata lookup", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useDealAuditLogs("deal-1", true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.auditFilter).toHaveBeenCalledWith("entity_id.eq.deal-1,meta->>order_id.eq.deal-1,meta->>orderId.eq.deal-1");
  });

  it("keeps a failed read distinct from an empty history", async () => {
    const failure = { code: "57014", message: "query failed" };
    mocks.readAudit.mockResolvedValue({ data: null, error: failure });
    const { wrapper } = harness();
    const { result } = renderHook(() => useDealAuditLogs("deal-1", true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(failure);
    expect(mocks.readAudit).toHaveBeenCalledTimes(1);
  });

  it("refreshes an earlier empty cache when history is opened", async () => {
    const { client, wrapper } = harness();
    client.setQueryData(["deal-audit", "deal-1"], []);
    mocks.readAudit.mockResolvedValue({ data: [{ id: "audit-1", actor_user_id: null }], error: null });
    const { result, rerender } = renderHook(({ enabled }) => useDealAuditLogs("deal-1", enabled), {
      wrapper,
      initialProps: { enabled: false },
    });
    expect(mocks.readAudit).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(mocks.readAudit).toHaveBeenCalledTimes(1);
  });

  it("can retry a failed read without repeating a manager mutation", async () => {
    mocks.readAudit
      .mockResolvedValueOnce({ data: null, error: { code: "57014" } })
      .mockResolvedValueOnce({ data: [{ id: "audit-1", actor_user_id: null }], error: null });
    const { wrapper } = harness();
    const { result } = renderHook(() => useDealAuditLogs("deal-1", true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mocks.readAudit).toHaveBeenCalledTimes(2);
  });

  it("does not discard audit entries when actor-profile enrichment fails", async () => {
    mocks.readAudit.mockResolvedValue({ data: [{ id: "audit-1", actor_user_id: "actor-1", actor_label: "Сотрудник" }], error: null });
    mocks.readProfiles.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { wrapper } = harness();
    const { result } = renderHook(() => useDealAuditLogs("deal-1", true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "audit-1", actor_label: "Сотрудник", actor_profile: null });
  });

  it("exposes only a safe error code, never raw database payloads", () => {
    expect(getDealAuditErrorCode({ code: "PGRST301", message: "private" })).toBe("PGRST301");
    expect(getDealAuditErrorCode({ code: "contains private data" })).toBe("REQUEST_FAILED");
    expect(getDealAuditErrorCode(new Error("private"))).toBe("REQUEST_FAILED");
  });

  it("renders an explicit error and retry instead of Нет записей", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/admin/DealDetailSheet.tsx"), "utf8");
    expect(source).toContain('useDealAuditLogs(deal?.id, open && activeTab === "history")');
    expect(source).toContain('role="alert"');
    expect(source).toContain("Повторить загрузку");
    expect(source).toContain("Обновить историю");
    expect(source.indexOf(") : auditError ? (")).toBeLessThan(source.indexOf(") : !auditLogs?.length ? ("));
    expect(source).toContain("log.actor_profile?.full_name || log.actor_label");
  });
});
