// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Hook tests — uses dependency-injected invoke (no Supabase, no network).

import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePaymentDocuments } from "@/hooks/usePaymentDocuments";

const baseCanonical = {
  payment: {
    id: "11111111-2222-3333-4444-555555555555",
    provider: "stripe",
    status: "succeeded",
    amount: 100,
    currency: "EUR",
    order_id: null,
    is_refund: false,
  },
  provider_documents: [],
  internal_documents: [],
  generation: { scenario_found: false, can_generate: false, blocked_reason: null },
  diagnostics: null,
  warnings: [],
};

const pid1 = "11111111-1111-1111-1111-111111111111";
const pid2 = "22222222-2222-2222-2222-222222222222";

describe("usePaymentDocuments", () => {
  it("first resolve sends refresh_provider=false", async () => {
    const invoke = vi.fn<(b: { payment_id: string; refresh_provider: boolean }) => Promise<{ data: unknown; error: unknown }>>(async (_b) => ({
      data: baseCanonical, error: null,
    }));
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0] as unknown[])[0]).toEqual({ payment_id: pid1, refresh_provider: false });
    expect(result.current.data).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it("refreshProviderDocuments sends refresh_provider=true and fully replaces data", async () => {
    let nth = 0;
    const invoke = vi.fn<(b: { payment_id: string; refresh_provider: boolean }) => Promise<{ data: unknown; error: unknown }>>(async () => {
      nth++;
      return {
        data: { ...baseCanonical, warnings: nth === 1 ? [] : [{ code: "REFUND_PARENT_NOT_RESOLVED" }] },
        error: null,
      };
    });
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(result.current.data?.warnings).toEqual([]);
    await act(async () => { await result.current.refreshProviderDocuments(); });
    const secondCall = invoke.mock.calls[1] as unknown as [{ refresh_provider: boolean }];
    expect(secondCall[0].refresh_provider).toBe(true);
    expect(result.current.data?.warnings).toEqual([{ code: "REFUND_PARENT_NOT_RESOLVED" }]);
  });

  it("stale response is discarded after paymentId changes", async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstPromise = new Promise((res) => { resolveFirst = res; });
    let call = 0;
    const invoke = vi.fn(async () => {
      call++;
      if (call === 1) {
        const data = await firstPromise;
        return { data, error: null };
      }
      return { data: { ...baseCanonical, payment: { ...baseCanonical.payment, id: pid2 } }, error: null };
    });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePaymentDocuments(id, { invoke }),
      { initialProps: { id: pid1 } },
    );
    act(() => { void result.current.resolveDocuments(); });
    rerender({ id: pid2 });
    await act(async () => { await result.current.resolveDocuments(); });
    // Now release the stale first request — it MUST NOT overwrite state.
    await act(async () => {
      resolveFirst({ ...baseCanonical, payment: { ...baseCanonical.payment, id: pid1 } });
      await firstPromise;
    });
    await waitFor(() => expect(result.current.data?.payment.id).toBe(pid2));
  });

  it("reset clears state and invalidates pending request", async () => {
    let resolveIt!: (v: unknown) => void;
    const p = new Promise((res) => { resolveIt = res; });
    const invoke = vi.fn(async () => ({ data: await p, error: null }));
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    act(() => { void result.current.resolveDocuments(); });
    act(() => { result.current.reset(); });
    expect(result.current.data).toBeNull();
    // Stale resolution AFTER reset must not surface.
    await act(async () => { resolveIt(baseCanonical); await p; });
    expect(result.current.data).toBeNull();
  });

  it("403 → forbidden error", async () => {
    const invoke = vi.fn(async () => ({
      data: { error: "FORBIDDEN" },
      error: Object.assign(new Error("x"), { context: { status: 403 } }),
    }));
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(result.current.error).toEqual({ kind: "forbidden" });
  });

  it("404 → not_found error", async () => {
    const invoke = vi.fn(async () => ({
      data: { error: "PAYMENT_NOT_FOUND" },
      error: Object.assign(new Error("x"), { context: { status: 404 } }),
    }));
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(result.current.error).toEqual({ kind: "not_found" });
  });

  it("network error → network", async () => {
    const invoke = vi.fn(async () => ({
      data: null, error: Object.assign(new Error("net"), { context: { status: 500 } }),
    }));
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(result.current.error).toEqual({ kind: "network" });
  });

  it("malformed body → malformed error, never raw object", async () => {
    const invoke = vi.fn(async () => ({ data: { not: "canonical" }, error: null }));
    const { result } = renderHook(() => usePaymentDocuments(pid1, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(result.current.error).toEqual({ kind: "malformed" });
    expect(result.current.data).toBeNull();
  });

  it("does not invoke if paymentId is null", async () => {
    const invoke = vi.fn();
    const { result } = renderHook(() => usePaymentDocuments(null, { invoke }));
    await act(async () => { await result.current.resolveDocuments(); });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("paymentId change resets previous state immediately", async () => {
    const invoke = vi.fn(async () => ({ data: baseCanonical, error: null }));
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => usePaymentDocuments(id, { invoke }),
      { initialProps: { id: pid1 as string | null } },
    );
    await act(async () => { await result.current.resolveDocuments(); });
    expect(result.current.data).toBeTruthy();
    rerender({ id: pid2 });
    expect(result.current.data).toBeNull();
  });
});
