/**
 * Invoice checkout detection.
 *
 * Оффер считается «invoice-only», если у него в meta.document_scenarios есть
 * ровно один включённый сценарий с payer_type='legal_entity' и в payment_channels
 * присутствует 'bank_transfer' (и нет других каналов, кроме bank_transfer).
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
  const meta = (offer as unknown as { meta?: Record<string, unknown> }).meta;
  const scenariosRaw = meta && typeof meta === "object" ? (meta as any).document_scenarios : null;
  if (!Array.isArray(scenariosRaw) || scenariosRaw.length === 0) {
    return { isInvoiceOnly: false, scenarioId: null };
  }

  const enabled = scenariosRaw.filter((s: any) => s && s.is_enabled !== false);
  if (enabled.length === 0) return { isInvoiceOnly: false, scenarioId: null };

  // Все включённые сценарии должны быть legal_entity + bank_transfer.
  const allInvoice = enabled.every((s: any) => {
    if (s.payer_type !== "legal_entity") return false;
    const channels = Array.isArray(s.payment_channels) ? s.payment_channels : [];
    // Пустой массив = «любой канал» — не считаем invoice-only.
    if (channels.length === 0) return false;
    // Требуем, чтобы только bank_transfer был в списке.
    return channels.every((c: string) => c === "bank_transfer");
  });

  if (!allInvoice) return { isInvoiceOnly: false, scenarioId: null };
  return { isInvoiceOnly: true, scenarioId: enabled[0]?.id ?? null };
}
