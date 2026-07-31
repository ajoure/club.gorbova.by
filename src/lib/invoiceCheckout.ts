/**
 * Invoice checkout detection.
 *
 * Источник истины — настройки самой кнопки/оффера. Настройки генерируемых
 * документов намеренно не участвуют в выборе checkout: один и тот же оффер
 * может иметь документы и для физлица, и для юрлица, не становясь от этого
 * кнопкой выставления счёта.
 *
 * В таком случае кнопка НЕ вызывает bePaid — вместо этого открывается
 * InvoiceCheckoutDialog, который создаёт заказ+сделку и выписывает счёт.
 */

import type { TariffOffer } from "@/hooks/usePublicProduct";

export interface InvoiceOnlyDetection {
  isInvoiceOnly: boolean;
  scenarioId: string | null;
}

export function detectInvoiceOnlyOffer(offer: TariffOffer | null | undefined): InvoiceOnlyDetection {
  if (!offer) return { isInvoiceOnly: false, scenarioId: null };
  const meta = offer.meta as (TariffOffer["meta"] & {
    slot_role?: string;
    site_button_variant?: string;
  }) | undefined;
  const isInvoiceOnly =
    offer.offer_type === "invoice" ||
    meta?.slot_role === "payment_invoice" ||
    meta?.site_button_variant === "legal_entity";

  return { isInvoiceOnly, scenarioId: null };
}
