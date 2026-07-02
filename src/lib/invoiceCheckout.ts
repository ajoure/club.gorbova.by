/**
 * Invoice checkout detection.
 *
 * Оффер считается «invoice-only», если среди включённых сценариев есть
 * сценарий payer_type='legal_entity' с единственным каналом 'bank_transfer'
 * и нет другого включённого legal_entity-сценария с эквайринговыми каналами.
 * Базовые/legacy сценарии физлица не должны ломать детект счёта для ЮЛ.
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

  const legalScenarios = enabled.filter((s: any) => s.payer_type === "legal_entity");
  if (legalScenarios.length === 0) return { isInvoiceOnly: false, scenarioId: null };

  const invoiceScenario = legalScenarios.find((s: any) => {
    const channels = Array.isArray(s.payment_channels)
      ? s.payment_channels
      : Array.isArray(s.payment_methods)
        ? s.payment_methods
        : [];
    return channels.length === 1 && channels[0] === "bank_transfer";
  });
  if (!invoiceScenario) return { isInvoiceOnly: false, scenarioId: null };

  const hasLegalAcquiringScenario = legalScenarios.some((s: any) => {
    if (s === invoiceScenario) return false;
    const channels = Array.isArray(s.payment_channels)
      ? s.payment_channels
      : Array.isArray(s.payment_methods)
        ? s.payment_methods
        : [];
    // Пустой массив = «любой канал», значит такой сценарий не invoice-only.
    if (channels.length === 0) return true;
    return channels.some((c: string) => c !== "bank_transfer");
  });

  if (hasLegalAcquiringScenario) return { isInvoiceOnly: false, scenarioId: null };
  return { isInvoiceOnly: true, scenarioId: invoiceScenario.id ?? null };
}
