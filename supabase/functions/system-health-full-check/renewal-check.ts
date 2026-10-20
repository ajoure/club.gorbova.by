import { isProviderRenewalOverdue } from "../_shared/payment-health-policy.ts";

export const RENEWAL_CHECK_RELEASE = "bepaid-renewal-health-2026-10-20-v2";
export const MAX_PROVIDER_PROBES = 20;
type Row = Record<string, any>;
export type RenewalEvidence = {
  classification: "healthy" | "overdue" | "unknown" | "declined";
  reason: string;
  state?: string;
  next_charge_at?: string;
  last_charge_at?: string | null;
};
const instant = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString() : null;

export const needsRenewalProbe = (row: Row, nowMs: number): boolean =>
  row.billing_review_required === true || row.billing_review_required === 'true' || isProviderRenewalOverdue({
    state: row.state, next_charge_at: row.next_charge_at, last_charge_at: row.last_charge_at,
  }, nowMs);

export async function loadRenewalCandidates(db: any, nowMs: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await db.from("provider_subscriptions")
      .select("id,provider_subscription_id,subscription_v2_id,state,next_charge_at,last_charge_at,billing_review_required:meta->paid_continuation_repair->>billing_review_required")
      .eq("provider", "bepaid").eq("state", "active")
      // A recorded consent mismatch must remain visible after the provider
      // dates are synchronized into the future. OR returns each row once.
      .or(`next_charge_at.lte.${new Date(nowMs - 86_400_000).toISOString()},meta->paid_continuation_repair->>billing_review_required.eq.true`)
      .order("id").range(from, from + 999);
    if (error || !Array.isArray(data)) throw new Error("renewal_snapshot_query_failed");
    rows.push(...data);
    if (data.length < 1000) {
      const ids = [...new Set(rows.map(row => row.subscription_v2_id).filter(Boolean))];
      const locals: Row[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const result = await db.from("subscriptions_v2").select("id,status,auto_renew").in("id", ids.slice(i, i + 200));
        if (result.error || !Array.isArray(result.data)) throw new Error("renewal_local_query_failed");
        locals.push(...result.data);
      }
      const byId = new Map(locals.map(row => [row.id, row]));
      return rows.map(row => ({ ...row, local_status: byId.get(row.subscription_v2_id)?.status,
        local_auto_renew: byId.get(row.subscription_v2_id)?.auto_renew }));
    }
  }
  throw new Error("renewal_snapshot_limit_exceeded");
}

/** A local terminal state is never proof of provider cancellation. */
export function classifyProviderRenewal(
  expectedId: string, payload: unknown, nowMs: number,
): RenewalEvidence {
  const value = payload as Row | null;
  const sub = value?.subscription ?? value;
  if (!sub || sub.id !== expectedId) {
    return { classification: "unknown", reason: "provider_identity_mismatch" };
  }
  const state = String(sub.state ?? sub.status ?? "").trim().toLowerCase();
  if (["canceled", "cancelled", "terminated", "expired", "completed"].includes(state)) {
    return { classification: "healthy", reason: "provider_terminal", state };
  }
  if (["failed", "error"].includes(state)) {
    // The provider DID attempt billing. Keep the decline visible for the
    // operator, separately from a stalled/missed provider renewal.
    return { classification: "declined", reason: "provider_payment_failed", state };
  }
  if (state !== "active" && state !== "trial") {
    return { classification: "unknown", reason: "provider_state_unknown" };
  }
  // Never fall back to the stale local/raw snapshot for the next due date.
  const next = instant(sub.renew_at) ?? instant(sub.next_billing_at);
  if (!next) return { classification: "unknown", reason: "provider_schedule_missing", state };
  const tx = sub.last_transaction;
  const successful = ["successful", "succeeded", "success", "paid"].includes(
    String(tx?.status ?? "").toLowerCase(),
  );
  const last = successful && Number.isInteger(tx?.amount) && tx.amount > 0 &&
    ["payment", "capture"].includes(String(tx?.type ?? "").toLowerCase()) &&
    instant(tx?.paid_at) && Date.parse(tx.paid_at) <= nowMs
    ? instant(tx.paid_at) : null;
  // Trials with a future scheduled charge are not overdue. A trial with an old
  // charge date still needs review rather than being silently discarded.
  const overdue = isProviderRenewalOverdue({ state: "active", next_charge_at: next, last_charge_at: last }, nowMs);
  return {
    classification: overdue ? "overdue" : "healthy",
    reason: overdue ? "provider_renewal_overdue" : "provider_schedule_or_payment_current",
    state, next_charge_at: next, last_charge_at: last,
  };
}

/** Fixed provider origin + GET only. No persistence, grants, queue or sends. */
export async function probeProviderRenewal(
  id: string, authorization: string, nowMs: number, fetcher: typeof fetch = fetch,
): Promise<RenewalEvidence> {
  if (!/^sbs_[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return { classification: "unknown", reason: "invalid_provider_identifier" };
  }
  try {
    const response = await fetcher(`https://api.bepaid.by/subscriptions/${encodeURIComponent(id)}`, {
      method: "GET", headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { classification: "unknown", reason: "provider_unavailable" };
    }
    // Never log/return customer, card, tracking or arbitrary upstream fields.
    const reader = response.body?.getReader();
    if (!reader) return { classification: "unknown", reason: "provider_empty_response" };
    let text = "", size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 131_072) throw new Error("oversized_response");
        text += decoder.decode(p.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => undefined); }
    return classifyProviderRenewal(id, JSON.parse(text), nowMs);
  } catch {
    return { classification: "unknown", reason: "provider_unavailable" };
  }
}

export async function verifyRenewalCandidates(
  rows: Row[], authorization: string | null, nowMs: number, fetcher: typeof fetch = fetch,
) {
  const candidates = rows.filter(row => needsRenewalProbe(row, nowMs));
  const results: RenewalEvidence[] = [];
  for (let offset = 0; offset < candidates.length; offset += 4) {
    results.push(...await Promise.all(candidates.slice(offset, offset + 4).map((row, i) =>
      offset + i >= MAX_PROVIDER_PROBES || !authorization
        ? { classification: "unknown" as const, reason: authorization ? "probe_limit_exceeded" : "credentials_unavailable" }
        : probeProviderRenewal(String(row.provider_subscription_id ?? ""), authorization, nowMs, fetcher)
    )));
  }
  const unresolved = results.filter(row => row.classification === "overdue" || row.classification === "unknown");
  const review = results.flatMap((result, i) => {
    if (result.classification === "declined") return [result];
    const local = candidates[i];
    if (result.state === "active" && result.classification === "healthy" &&
      (!["active", "trial"].includes(String(local.local_status ?? "")) || local.local_auto_renew === false)) {
      return [{ ...result, reason: "provider_active_local_not_renewing" }];
    }
    return [];
  });
  return {
    code: "INV-P0-1", name: "Просроченные автопродления bePaid (>24ч)",
    passed: unresolved.length === 0, count: unresolved.length, severity: "CRITICAL" as const,
    verification: { candidates: candidates.length, healthy: results.filter(row => row.classification === "healthy").length,
      overdue: results.filter(row => row.classification === "overdue").length,
      declined: results.filter(row => row.classification === "declined").length,
      unknown: results.filter(row => row.classification === "unknown").length,
      source: "provider_get", release: RENEWAL_CHECK_RELEASE },
    samples: unresolved.slice(0, 5),
    review: { code: "INV-P0-1-R", name: "Проверка отклонённых платежей и состояния подписок",
      passed: review.length === 0, count: review.length, severity: "WARNING" as const,
      samples: review.slice(0, 5) },
  };
}
