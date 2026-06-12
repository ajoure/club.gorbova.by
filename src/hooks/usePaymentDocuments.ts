// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Thin consumer of canonical resolver `admin-payment-documents-resolve`.
//
// Contract:
//   - Body: { payment_id, refresh_provider }
//   - Default first open: refresh_provider=false
//   - refreshProviderDocuments() — manual only, replaces response fully
//   - reset() — clears state + invalidates pending requests; signed URLs go
//     out of memory together with the drawer mount
//   - Stale-response guard via monotonically increasing request sequence and
//     a pinned paymentId; old responses are discarded
//   - No automatic prefetch; resolveDocuments() is invoked only by the drawer
//     after it actually opens for a specific payment

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  isResolverResponse,
  type ResolverResponse,
} from "@/types/paymentDocuments";

export type PaymentDocumentsError =
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "network" }
  | { kind: "malformed" };

interface State {
  data: ResolverResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: PaymentDocumentsError | null;
}

const initialState: State = {
  data: null,
  loading: false,
  refreshing: false,
  error: null,
};

interface InvokeDeps {
  invoke?: (body: { payment_id: string; refresh_provider: boolean }) =>
    Promise<{ data: unknown; error: unknown }>;
}

export function usePaymentDocuments(
  paymentId: string | null,
  deps: InvokeDeps = {},
) {
  const [state, setState] = useState<State>(initialState);
  // Sequence guard: any response whose seq ≠ latestSeq is dropped.
  const seqRef = useRef(0);
  // Pin the paymentId associated with the in-flight request.
  const pinnedIdRef = useRef<string | null>(null);

  const invokeFn = deps.invoke ?? (async (body) =>
    supabase.functions.invoke("admin-payment-documents-resolve", { body })
  );

  const classifyError = (
    err: unknown,
    data: unknown,
  ): PaymentDocumentsError => {
    // supabase.functions.invoke surfaces an Error-like object with `context`
    // (Response). We avoid leaking raw error/stack to the UI.
    const ctx = (err as { context?: { status?: number } } | undefined)?.context;
    const status = ctx?.status;
    if (status === 401 || status === 403) return { kind: "forbidden" };
    if (status === 404) return { kind: "not_found" };
    // Some envelopes put the error on the data payload.
    if (
      data && typeof data === "object" && data !== null &&
      (data as { error?: string }).error === "FORBIDDEN"
    ) return { kind: "forbidden" };
    if (
      data && typeof data === "object" && data !== null &&
      (data as { error?: string }).error === "PAYMENT_NOT_FOUND"
    ) return { kind: "not_found" };
    return { kind: "network" };
  };

  const runInvoke = useCallback(
    async (refresh: boolean): Promise<void> => {
      if (!paymentId) return;
      const seq = ++seqRef.current;
      pinnedIdRef.current = paymentId;
      setState((s) => ({
        ...s,
        loading: refresh ? s.loading : true,
        refreshing: refresh,
        error: null,
      }));

      const { data, error } = await invokeFn({
        payment_id: paymentId,
        refresh_provider: refresh,
      });

      // Stale-response guard — discard if a newer request started or the
      // pinned paymentId changed (drawer closed / switched row).
      if (seq !== seqRef.current) return;
      if (pinnedIdRef.current !== paymentId) return;

      if (error || !isResolverResponse(data)) {
        setState({
          data: null,
          loading: false,
          refreshing: false,
          error: error ? classifyError(error, data) : { kind: "malformed" },
        });
        return;
      }

      setState({
        data, // canonical replacement — no frontend merge of provider docs
        loading: false,
        refreshing: false,
        error: null,
      });
    },
    [paymentId, invokeFn],
  );

  const resolveDocuments = useCallback(() => runInvoke(false), [runInvoke]);
  const refreshProviderDocuments = useCallback(
    () => runInvoke(true),
    [runInvoke],
  );

  const reset = useCallback(() => {
    seqRef.current++; // invalidate any in-flight request
    pinnedIdRef.current = null;
    setState(initialState);
  }, []);

  // When paymentId changes, drop stale state immediately so the previous
  // payment's signed URLs do not linger in component memory.
  useEffect(() => {
    seqRef.current++;
    pinnedIdRef.current = null;
    setState(initialState);
  }, [paymentId]);

  return {
    data: state.data,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    resolveDocuments,
    refreshProviderDocuments,
    reset,
  };
}
