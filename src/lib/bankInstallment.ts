/**
 * Bank-installment offer helper.
 * Reads meta.bank_installment.{external_link,link_label,message_html} with a
 * project-level default link so buttons work even when meta is not filled in yet.
 */
export const DEFAULT_BANK_INSTALLMENT_LINK =
  "https://pay.rrllc.ru/katerina-gorbova-credit";

export interface BankInstallmentMeta {
  external_link?: string | null;
  link_label?: string | null;
  message_html?: string | null;
}

export function readBankInstallmentMeta(offer: { meta?: any } | null | undefined) {
  const raw = (offer?.meta as { bank_installment?: BankInstallmentMeta } | undefined)
    ?.bank_installment;
  return {
    bankLinkUrl: (raw?.external_link || DEFAULT_BANK_INSTALLMENT_LINK).trim(),
    bankLinkLabel: raw?.link_label?.trim() || undefined,
    bankMessageHtml: raw?.message_html?.trim() || undefined,
  };
}
