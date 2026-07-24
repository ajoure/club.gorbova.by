/**
 * useComposableQuoteSummary — shared fetcher for canonical composable checkout
 * quote used to render the "Состав заказа" (OrderSummary) inside each
 * downstream dialog (LeadRequestDialog, PaymentDialog, InvoiceCheckoutDialog).
 *
 * Contract:
 *  - Reads via existing `composable-checkout-quote` Edge Function. No new
 *    endpoints, no hardcoded prices, no hardcoded discounts.
 *  - Only fetches while the dialog is `open`.
 *  - Empty addonOfferIds is a valid call — returns primary line + total so we
 *    can still render a minimal summary if desired.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OrderSummaryLine } from "@/components/checkout/OrderSummary";

export interface ComposableQuoteSummary {
  items: OrderSummaryLine[];
  currency: string;
  total: number | null;
  subtotal: number | null;
  adjustmentAmount: number;
  loading: boolean;
}

export function useComposableQuoteSummary(params: {
  open: boolean;
  offerId: string | null | undefined;
  addonOfferIds: string[];
  fallbackCurrency?: string;
  fallbackTotal?: number | null;
}): ComposableQuoteSummary {
  const { open, offerId, addonOfferIds, fallbackCurrency = "BYN", fallbackTotal = null } = params;
  const [state, setState] = useState<ComposableQuoteSummary>({
    items: [],
    currency: fallbackCurrency,
    total: fallbackTotal,
    subtotal: null,
    adjustmentAmount: 0,
    loading: false,
  });

  const addonsKey = JSON.stringify([...addonOfferIds].sort());

  useEffect(() => {
    if (!open || !offerId) return;
    let active = true;
    setState((s) => ({ ...s, loading: true }));
    void supabase.functions
      .invoke("composable-checkout-quote", {
        body: { parent_offer_id: offerId, addon_offer_ids: addonOfferIds },
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data || (data as any).error) {
          setState((s) => ({ ...s, loading: false }));
          return;
        }
        const q = data as any;
        const items: OrderSummaryLine[] = (q.items ?? []).map((it: any) => ({
          role: it.role,
          product_name: it.product_name,
          tariff_name: it.tariff_name ?? null,
          list_amount: Number(it.list_amount ?? 0),
          final_amount: Number(it.final_amount ?? 0),
          discount_amount: Number(it.discount_amount ?? 0),
          discount_percent: it.discount_percent ?? null,
          pricing_mode: it.pricing_mode,
        }));
        setState({
          items,
          currency: String(q.currency ?? fallbackCurrency),
          total: Number(q.total ?? fallbackTotal ?? 0),
          subtotal: q.subtotal != null ? Number(q.subtotal) : null,
          adjustmentAmount: Number(q.adjustment_amount ?? 0),
          loading: false,
        });
      });
    return () => {
      active = false;
    };
  }, [open, offerId, addonsKey, fallbackCurrency, fallbackTotal]);

  return state;
}
