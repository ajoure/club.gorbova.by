import { describe, expect, it } from "vitest";
import type { TariffOffer } from "@/hooks/usePublicProduct";
import { detectInvoiceOnlyOffer } from "@/lib/invoiceCheckout";

function offer(overrides: Partial<TariffOffer> = {}): TariffOffer {
  return {
    id: "offer-id",
    tariff_id: "tariff-id",
    offer_type: "pay_now",
    button_label: "Оплатить",
    amount: 100,
    trial_days: null,
    auto_charge_after_trial: false,
    auto_charge_amount: null,
    auto_charge_delay_days: null,
    requires_card_tokenization: false,
    sort_order: 0,
    ...overrides,
  };
}

describe("detectInvoiceOnlyOffer", () => {
  it("keeps an ordinary card button on card checkout even when legal documents are configured", () => {
    const result = detectInvoiceOnlyOffer(offer({
      payment_method: "full_payment",
      meta: {
        document_scenarios: [{
          id: "legal-bank-documents",
          payer_type: "legal_entity",
          payment_channels: ["bank_transfer"],
          is_enabled: true,
        }],
      },
    }));

    expect(result.isInvoiceOnly).toBe(false);
  });

  it("routes a canonical invoice offer to invoice checkout", () => {
    expect(detectInvoiceOnlyOffer(offer({ offer_type: "invoice" })).isInvoiceOnly).toBe(true);
  });

  it("supports configured legacy invoice buttons without inspecting their label", () => {
    expect(detectInvoiceOnlyOffer(offer({
      button_label: "Любой текст",
      meta: { slot_role: "payment_invoice", site_button_variant: "legal_entity" },
    })).isInvoiceOnly).toBe(true);
  });

  it("routes an explicitly bank-transfer offer to invoice checkout", () => {
    expect(detectInvoiceOnlyOffer(offer({ payment_method: "bank_transfer" })).isInvoiceOnly).toBe(true);
  });
});
