/**
 * Bank-installment offer helper.
 * Reads meta.bank_installment.{external_link,link_label,message_html} with a
 * project-level default link so buttons work even when meta is not filled in yet.
 *
 * Sprint B: also surfaces meta.bank_installment.rr_runtime — feature flag that
 * routes selected offer(s) through public-rr-installment-initiate edge instead
 * of the legacy static external_link.
 */
export const DEFAULT_BANK_INSTALLMENT_LINK =
  "https://pay.rrllc.ru/katerina-gorbova-credit";

export interface BankInstallmentMeta {
  external_link?: string | null;
  link_label?: string | null;
  message_html?: string | null;
  rr_runtime?: {
    enabled?: boolean;
    provider?: "rr" | string;
    mode?: string;
  } | null;
}

export interface BankInstallmentRuntime {
  enabled: boolean;
  provider: "rr";
}

export function readBankInstallmentMeta(offer: { meta?: any } | null | undefined) {
  const raw = (offer?.meta as { bank_installment?: BankInstallmentMeta } | undefined)
    ?.bank_installment;
  const rt = raw?.rr_runtime;
  const runtime: BankInstallmentRuntime | undefined =
    rt?.enabled === true && rt.provider === "rr"
      ? { enabled: true, provider: "rr" }
      : undefined;
  return {
    bankLinkUrl: (raw?.external_link || DEFAULT_BANK_INSTALLMENT_LINK).trim(),
    bankLinkLabel: raw?.link_label?.trim() || undefined,
    bankMessageHtml: raw?.message_html?.trim() || undefined,
    bankInstallmentRuntime: runtime,
  };
}
