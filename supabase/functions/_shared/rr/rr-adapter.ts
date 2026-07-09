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
  // Deno WebCrypto не поддерживает MD5 — используем npm-пакет.
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
  externalId: string; // должен начинаться с rr_test_
  amountMinor: number;
  currency: string; // передаётся как есть в РР; фактическая поддержка валют выясняется runtime-тестом
  notificationUrl: string;
  completeUrl?: string;
  failUrl?: string;
  correlationId: string;
}

export interface RRCreateOrderResult {
  ok: boolean;
  status: number;
  rrRequestId?: string;
  paymentUrl?: string;
  rrStatusRaw?: string;
  errorText?: string;
  http: RRHttpCallResult;
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
      items: [
        {
          name: "RR core test order",
          quantity: 1,
          price: amountRub,
        },
      ],
    },
    notification_url: input.notificationUrl,
    complete_url: input.completeUrl,
    fail_url: input.failUrl,
    // client_info намеренно не передаём — тестовая заявка без PII.
  };

  const res = await rrHttpPost({
    baseUrl: cfg.baseUrl,
    path: "/createOrder",
    login: cfg.login,
    password: cfg.password,
    body,
    correlationId: input.correlationId,
  });

  const json = (res.json ?? {}) as Record<string, unknown>;
  const err = (json.error ?? null) as Record<string, unknown> | null;

  return {
    ok: res.ok && !err,
    status: res.status,
    rrRequestId: (json.id as string) ?? input.externalId,
    paymentUrl: json.link as string | undefined,
    rrStatusRaw: json.status as string | undefined,
    errorText: err ? String(err.text ?? "rr_error") : undefined,
    http: res,
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

  return {
    ok: res.ok && !err,
    status: res.status,
    rrStatusRaw: json.status as string | undefined,
    amountMinor: Math.round(amount * 100),
    completedAmountMinor: Math.round(completed * 100),
    commissionMinor: commission == null ? null : Math.round(commission * 100),
    errorText: err ? String(err.text ?? "rr_error") : undefined,
    http: res,
  };
}

/**
 * Строит redacted-версию ответа РР для сохранения в rr_test_ledger.raw_last
 * и в payload_meta логов. Не содержит секретов, PII, полных подписей.
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
    "link",
    "error",
  ];
  for (const k of allowedKeys) {
    if (k in src) out[k] = src[k];
  }
  // никогда не пробрасываем: client_info, payments[].* details, secretKey, sign, salt, headers
  return out;
}
