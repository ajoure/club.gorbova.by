/**
 * startBankInstallment — resolver для «Рассрочка банка».
 *
 * Инкапсулирует выбор между runtime-провайдером (Sprint B: РР через
 * public-rr-installment-initiate) и legacy external_link. UI (LeadRequestDialog
 * и лендинги) не должны знать про конкретных провайдеров.
 */
import { supabase } from "@/integrations/supabase/client";
import type { BankInstallmentRuntime } from "@/lib/bankInstallment";

export interface StartBankInstallmentInput {
  offerId: string;
  addonOfferIds?: string[];
  runtime?: BankInstallmentRuntime;
  legacyBankLinkUrl?: string;
  legacyBankLinkLabel?: string;
  legacyBankMessageHtml?: string;
  contact: {
    name: string;
    phone: string;
    email: string;
    comment?: string | null;
  };
  customerCreditRequestedMinor?: number;
  partnerBonusRequestedMinor?: number;
  partnerBonusCheckoutKey?: string;
}

export type StartBankInstallmentResult =
  | {
      mode: "runtime";
      provider: "rr";
      paymentUrl: string;
      orderId: string;
      reused: boolean;
    }
  | {
      mode: "legacy";
      bankLinkUrl?: string;
      bankLinkLabel?: string;
      bankMessageHtml?: string;
    };

export async function startBankInstallment(
  input: StartBankInstallmentInput,
): Promise<StartBankInstallmentResult> {
  if (input.runtime?.enabled && input.runtime.provider === "rr") {
    const { data, error } = await supabase.functions.invoke(
      "public-rr-installment-initiate",
      {
        body: {
          tariff_offer_id: input.offerId,
          addon_offer_ids: input.addonOfferIds ?? [],
          name: input.contact.name,
          phone: input.contact.phone,
          email: input.contact.email,
          comment: input.contact.comment ?? null,
          customer_credit_requested_minor: Math.max(0, Math.round(Number(input.customerCreditRequestedMinor ?? 0))),
          partner_bonus_requested_minor: Math.max(0, Math.round(Number(input.partnerBonusRequestedMinor ?? 0))),
          partner_bonus_checkout_key: input.partnerBonusCheckoutKey,
        },
      },
    );
    if (error) throw error;
    if (data?.error) throw new Error(String(data.error));
    if (!data?.payment_url) throw new Error("rr_no_payment_url");
    return {
      mode: "runtime",
      provider: "rr",
      paymentUrl: String(data.payment_url),
      orderId: String(data.order_id),
      reused: Boolean(data.reused),
    };
  }

  return {
    mode: "legacy",
    bankLinkUrl: input.legacyBankLinkUrl,
    bankLinkLabel: input.legacyBankLinkLabel,
    bankMessageHtml: input.legacyBankMessageHtml,
  };
}
