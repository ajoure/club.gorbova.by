// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Pure UI helpers for the payment documents drawer.
// No DB, no fetch, no business logic. Frontend-only secondary safety net.

import type {
  MachineCode,
  ProviderDocument,
  InternalDocument,
} from "@/types/paymentDocuments";

/**
 * Secondary HTTPS guard. Backend already enforces a strict provider allowlist;
 * frontend additionally refuses anything that is not parseable HTTPS so a
 * malformed `javascript:`/`data:` URL can never become an action.
 */
export function isSafeHttpsUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Mask a UUID-like identifier for display. */
export function maskUuid(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length < 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

// ── Machine code localization ────────────────────────────────────────────────
// Covers every known backend machine code (generation + warning +
// Stripe-client resolution details). Unknown codes get a safe fallback.

const CODE_RU: Partial<Record<MachineCode, string>> = {
  // Generation
  NO_DOCUMENT_SCENARIO: "Для этого платежа нет сценария документа",
  MISSING_REQUIRED_REQUISITES: "Не хватает обязательных реквизитов",
  DOCUMENT_ALREADY_GENERATED: "Документ уже сформирован",
  GENERATION_IN_PROGRESS: "Документ формируется",
  GENERATION_FAILED: "Не удалось сформировать документ",
  PAYMENT_NOT_LINKED_TO_ORDER: "Платёж не связан с заказом",
  REFUND_USES_PARENT_DOCUMENTS: "Документ относится к исходному платежу",

  // Stripe account/mode resolution
  STRIPE_ACCOUNT_NOT_RESOLVED: "Конфигурация Stripe-аккаунта недоступна",
  STRIPE_ACCOUNT_CODE_CONFLICT: "Конфликт Stripe-аккаунта",
  STRIPE_CONNECTION_AMBIGUOUS: "Несколько активных подключений Stripe",
  STRIPE_MODE_NOT_RESOLVED: "Режим Stripe (test/live) не определён",
  STRIPE_MODE_CONFLICT: "Конфликт режима Stripe",
  STRIPE_MODE_MISMATCH: "Режим платежа не совпадает с подключением Stripe",

  // Stripe client / network (surfaced as warning detail)
  STRIPE_SECRET_UNAVAILABLE: "Секрет Stripe недоступен",
  INVALID_STRIPE_RESOURCE: "Документ провайдера временно недоступен",
  INVALID_STRIPE_ID: "Документ провайдера временно недоступен",
  STRIPE_HTTP_ERROR: "Провайдер временно недоступен",
  NETWORK_ERROR: "Сетевая ошибка при обращении к провайдеру",
  REQUEST_TIMEOUT: "Превышено время ожидания провайдера",

  // URL / refund / refresh warnings
  UNSAFE_DOCUMENT_URL: "Ссылка на документ отклонена системой безопасности",
  PROVIDER_DOCUMENT_ID_NOT_RESOLVED: "Идентификатор документа не определён",
  REFUND_PARENT_NOT_RESOLVED: "Не удалось определить исходный платёж возврата",
  BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY:
    "Получение документов провайдера временно недоступно",
  PROVIDER_DOCUMENT_RETRIEVE_FAILED:
    "Не удалось получить документ у провайдера",
  GENERATION_RESOLVER_NOT_READ_ONLY:
    "Сервис генерации временно недоступен",
};

const SAFE_FALLBACK = "Действие с документом сейчас недоступно";

export function localizeMachineCode(code: string | null | undefined): string {
  if (!code) return SAFE_FALLBACK;
  return CODE_RU[code as MachineCode] ?? SAFE_FALLBACK;
}

// ── Provider type labels ─────────────────────────────────────────────────────

const PROVIDER_DOC_TYPE_RU: Record<string, string> = {
  receipt: "Чек",
  hosted_invoice: "Инвойс (страница)",
  invoice_pdf: "Инвойс (PDF)",
  credit_note_pdf: "Кредит-нота (PDF)",
  refund_receipt: "Чек возврата",
};

export function providerDocTypeLabel(type: string): string {
  return PROVIDER_DOC_TYPE_RU[type] ?? type;
}

const PROVIDER_LABEL_RU: Record<string, string> = {
  stripe: "Stripe",
  bepaid: "bePaid",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL_RU[provider] ?? provider;
}

const SOURCE_RU: Record<string, string> = {
  local_meta: "Локальные данные",
  provider_api: "API провайдера",
  "local_meta+provider_api": "Локальные данные + API",
  parent_payment: "Исходный платёж",
  internal_storage: "Внутреннее хранилище",
};

export function sourceLabel(source: string): string {
  return SOURCE_RU[source] ?? source;
}

const STATUS_RU: Record<string, string> = {
  available: "Доступен",
  unavailable: "Недоступен",
  error: "Ошибка",
  generated: "Сформирован",
  pending: "Формируется",
  failed: "Ошибка",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_RU[status] ?? status;
}

// ── Capability → final action visibility ─────────────────────────────────────
// Combines backend capability with frontend HTTPS secondary guard.

export interface DocumentActionCapabilities {
  canOpen: boolean;
  canDownload: boolean;
  canCopy: boolean;
}

export function resolveCapabilities(
  doc: Pick<ProviderDocument, "url" | "can_open" | "can_download" | "can_copy">
    | Pick<InternalDocument, "url" | "can_open" | "can_download" | "can_copy">,
): DocumentActionCapabilities {
  const safeUrl = isSafeHttpsUrl(doc.url);
  return {
    canOpen: !!doc.can_open && safeUrl,
    canDownload: !!doc.can_download && safeUrl,
    canCopy: !!doc.can_copy && safeUrl,
  };
}
