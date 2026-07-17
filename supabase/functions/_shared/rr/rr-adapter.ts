/**
 * RRPaymentProviderAdapter (test-core scope).
 *
 * Работает только с test-режимом. Не знает про orders_v2/payments_v2,
 * продукты, офферы, клиентов. Оперирует суммой и external_id.
 */
import { rrHttpPost, RRHttpCallResult } from "./rr-http.ts";
import { RRResolvedConfig } from "./rr-config.ts";

export type RRStatusRaw =
  | "new"
  | "approved"
  | "accepted"
  | "wait_client"
  | "processing"
  | "approved_credit"
  | "authorized"
  | "authorized_all"
  | "authorized_partially"
  | "rejected"
  | "canceled"
  | "canceled_by_user"
  | "refunded";

export type RRStatusInternal =
  | "created"
  | "pending"
  | "paid"
  | "canceled"
  | "failed"
  | "expired";

export function mapStatus(raw: string | null | undefined): RRStatusInternal {
  switch (raw) {
    case "new":
      return "created";
    case "approved":
    case "accepted":
    case "wait_client":
    case "processing":
    case "approved_credit":
    case "authorized_partially":
      return "pending";
    case "authorized":
    case "authorized_all":
      return "paid";
    case "rejected":
      return "failed";
    case "canceled":
    case "canceled_by_user":
      return "canceled";
    case "refunded":
      return "canceled";
    default:
      return "pending";
  }
}

async function md5Hex(input: string): Promise<string> {
  const mod = await import("npm:blueimp-md5@2.19.0");
  const md5 = (mod.default ?? mod) as (s: string) => string;
  return md5(input);
}

export async function verifyNotificationSignature(input: {
  newStatus: string;
  salt: string;
  sign: string;
  secretKey: string;
}): Promise<{ valid: boolean; expectedShort: string; providedShort: string }> {
  const computed = await md5Hex(
    `${input.newStatus}_${input.secretKey}_${input.salt}`,
  );
  const provided = (input.sign || "").toLowerCase();
  const valid = computed.length > 0 && computed === provided;
  return {
    valid,
    expectedShort: computed.slice(0, 8),
    providedShort: provided.slice(0, 8),
  };
}

export interface RRCreateOrderInput {
  externalId: string;
  amountMinor: number;
  currency: string;
  notificationUrl: string;
  completeUrl?: string;
  failUrl?: string;
  correlationId: string;
  itemName?: string;
}


export type RRFailureKind =
  | "timeout"
  | "network"
  | "invalid_json"
  | "http"
  | "invalid_response"
  | null;

export type RROutcomeClass =
  | "upstream_created"
  | "upstream_rejected"
  | "upstream_outcome_unknown";

export interface RRCreateOrderResult {
  ok: boolean;
  status: number;
  providerRequestId: string | null;
  paymentUrl: string | null;
  rrStatusRaw?: string;
  errorText?: string;
  http: RRHttpCallResult;
  failureKind: RRFailureKind;
  outcomeClass: RROutcomeClass;
}

function classifyPaymentUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Documented RR rejection allowlist. Gate A.1 v3: EMPTY.
 *
 * До заполнения gate_a1/rr_provider_contract.md (test-response РР +
 * подтверждённые коды) НИ ОДИН 4xx не классифицируется как upstream_rejected.
 * Всё непонятное → upstream_outcome_unknown (safe-default).
 *
 * Только точное совпадение (httpStatus, providerCode) даёт rejected.
 */
const RR_DOCUMENTED_REJECTION_CODES: Array<
  { httpStatus: number; providerCode: string }
> = [];

function isDocumentedRejection(
  httpStatus: number,
  providerCode: string | null,
): boolean {
  if (!providerCode) return false;
  return RR_DOCUMENTED_REJECTION_CODES.some(
    (r) => r.httpStatus === httpStatus && r.providerCode === providerCode,
  );
}

export async function rrCreateOrder(
  cfg: RRResolvedConfig,
  input: RRCreateOrderInput,
): Promise<RRCreateOrderResult> {
  const amountRub = (input.amountMinor / 100).toFixed(2);
  const body = {
    order: {
      version: "2.0",
      id: input.externalId,
      amount: amountRub,
      currency: input.currency,
      items: [{ name: "RR core test order", quantity: 1, price: amountRub }],
    },
    notification_url: input.notificationUrl,
    complete_url: input.completeUrl,
    fail_url: input.failUrl,
  };

  const res = await rrHttpPost({
    baseUrl: cfg.baseUrl,
    path: "/createOrder",
    login: cfg.login,
    password: cfg.password,
    body,
    correlationId: input.correlationId,
  });

  // failureKind — по типу транспортного/протокольного сбоя, не по тексту.
  let failureKind: RRFailureKind = null;
  const httpAny = res as unknown as {
    parseError?: boolean;
    aborted?: boolean;
    networkError?: boolean;
  };
  if (httpAny.aborted) failureKind = "timeout";
  else if (httpAny.networkError) failureKind = "network";
  else if (httpAny.parseError) failureKind = "invalid_json";
  else if (!res.ok) failureKind = "http";

  const json = (res.json ?? {}) as Record<string, unknown>;
  const err = (json.error ?? null) as Record<string, unknown> | null;
  const providerErrCode = err && typeof err.code === "string"
    ? (err.code as string)
    : null;
  const rawId = json.id;
  const providerRequestId = typeof rawId === "string" && rawId.length > 0
    ? rawId
    : null;
  const paymentUrl = classifyPaymentUrl(json.link) ? (json.link as string) : null;

  // Consortive classifier (Gate A.1 v3).
  let outcomeClass: RROutcomeClass;
  if (res.ok && !err && paymentUrl) {
    outcomeClass = "upstream_created";
  } else if (res.ok && !err && !paymentUrl) {
    // 2xx без валидного link — нарушение контракта провайдера.
    outcomeClass = "upstream_outcome_unknown";
    failureKind = "invalid_response";
  } else if (
    res.status >= 400 && res.status < 500 &&
    isDocumentedRejection(res.status, providerErrCode)
  ) {
    // Только точное совпадение allowlist → rejected.
    outcomeClass = "upstream_rejected";
  } else {
    // Всё остальное (timeout / network / 5xx / любой 4xx без allowlist / invalid_json) →
    // безопасный default.
    outcomeClass = "upstream_outcome_unknown";
  }

  return {
    ok: outcomeClass === "upstream_created",
    status: res.status,
    providerRequestId,
    paymentUrl,
    rrStatusRaw: json.status as string | undefined,
    errorText: err ? String(err.text ?? providerErrCode ?? "rr_error") : undefined,
    http: res,
    failureKind,
    outcomeClass,
  };
}


export interface RRGetStatusResult {
  ok: boolean;
  status: number;
  rrStatusRaw?: string;
  amountMinor?: number;
  completedAmountMinor?: number;
  commissionMinor?: number | null;
  errorText?: string;
  errorCode?: string;
  paymentUrl?: string;
  http: RRHttpCallResult;
}

export async function rrGetOrderStatus(
  cfg: RRResolvedConfig,
  externalId: string,
): Promise<RRGetStatusResult> {
  const res = await rrHttpPost({
    baseUrl: cfg.baseUrl,
    path: `/${encodeURIComponent(externalId)}/getOrderStatus`,
    login: cfg.login,
    password: cfg.password,
    body: {},
  });

  const json = (res.json ?? {}) as Record<string, unknown>;
  const err = (json.error ?? null) as Record<string, unknown> | null;

  const amount = typeof json.amount === "number"
    ? json.amount
    : parseFloat(String(json.amount ?? "0")) || 0;
  const completed = typeof json.completedAmount === "number"
    ? json.completedAmount
    : parseFloat(String(json.completedAmount ?? "0")) || 0;
  const commissionRaw = json.commission;
  const commission = commissionRaw == null
    ? null
    : typeof commissionRaw === "number"
    ? commissionRaw
    : parseFloat(String(commissionRaw)) || 0;
  const link = typeof json.link === "string" ? json.link : undefined;
  const errCode = err && typeof err.code !== "undefined"
    ? String(err.code)
    : undefined;

  return {
    ok: res.ok && !err,
    status: res.status,
    rrStatusRaw: json.status as string | undefined,
    amountMinor: Math.round(amount * 100),
    completedAmountMinor: Math.round(completed * 100),
    commissionMinor: commission == null ? null : Math.round(commission * 100),
    errorText: err ? String(err.text ?? "rr_error") : undefined,
    errorCode: errCode,
    paymentUrl: link,
    http: res,
  };
}

/**
 * Строит redacted-версию ответа РР для сохранения в rr_test_ledger.raw_last
 * и в payload_meta логов. Не содержит секретов, PII, полных подписей.
 * payment_url не сохраняем полностью — только флаг присутствия + длина.
 */
export function redactRRResponse(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== "object") return {};
  const src = json as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const allowedKeys = [
    "id",
    "status",
    "amount",
    "completedAmount",
    "creditAmount",
    "commission",
    "currency",
    "error",
  ];
  for (const k of allowedKeys) {
    if (k in src) out[k] = src[k];
  }
  // link → только флаг + длина, без самого URL.
  if (typeof src.link === "string") {
    out.link_present = true;
    out.link_len = (src.link as string).length;
  }
  return out;
}
