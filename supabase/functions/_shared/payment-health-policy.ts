export const RENEWAL_GRACE_MS = 24 * 60 * 60 * 1000;

export interface ProviderRenewalSnapshot {
  state: string | null;
  next_charge_at: string | null;
  last_charge_at: string | null;
}

export function isProviderRenewalOverdue(
  row: ProviderRenewalSnapshot,
  nowMs: number,
  graceMs = RENEWAL_GRACE_MS,
): boolean {
  if (row.state !== "active" || !row.next_charge_at) return false;

  const nextChargeMs = Date.parse(row.next_charge_at);
  if (!Number.isFinite(nextChargeMs) || nextChargeMs > nowMs - graceMs) return false;

  if (!row.last_charge_at) return true;
  const lastChargeMs = Date.parse(row.last_charge_at);
  return !Number.isFinite(lastChargeMs) || lastChargeMs < nextChargeMs;
}

export interface WebhookDeliveryEvidence {
  webhookCount: number;
  successfulPaymentCount: number;
  queryFailed: boolean;
}

export function evaluateWebhookDelivery(evidence: WebhookDeliveryEvidence): {
  passed: boolean;
  quietWindow: boolean;
} {
  if (evidence.queryFailed) return { passed: false, quietWindow: false };
  if (evidence.webhookCount > 0) return { passed: true, quietWindow: false };

  // The absence of webhook traffic cannot prove a transport outage when no
  // bePaid payment activity occurred in the same window.
  if (evidence.successfulPaymentCount === 0) {
    return { passed: true, quietWindow: true };
  }

  return { passed: false, quietWindow: false };
}

export interface CronRunEvidence {
  successfulRpcRuns: number;
  cronAuditRows: number;
  rpcFailed: boolean;
}

export function evaluateCronRuns(evidence: CronRunEvidence): {
  passed: boolean;
  source: "rpc" | "audit_fallback" | "none";
  count: number;
} {
  if (!evidence.rpcFailed && evidence.successfulRpcRuns > 0) {
    return { passed: true, source: "rpc", count: evidence.successfulRpcRuns };
  }
  if (evidence.cronAuditRows > 0) {
    return { passed: true, source: "audit_fallback", count: evidence.cronAuditRows };
  }
  return { passed: false, source: "none", count: 0 };
}
