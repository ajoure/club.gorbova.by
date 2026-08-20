import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddonPicker } from "@/components/checkout/AddonPicker";
import { OrderSummary, type OrderSummaryLine } from "@/components/checkout/OrderSummary";

type Addon = {
  addon_offer_id: string;
  addon_product_name: string;
  addon_tariff_name: string;
  list_amount: number;
  pricing_mode: "offer_price" | "fixed_price" | "percent_discount" | "free";
  fixed_amount: number | null;
  discount_percent: number | null;
  is_required: boolean;
  is_default_selected: boolean;
};

type QuoteItem = {
  role: "primary" | "addon";
  product_name: string;
  tariff_name?: string | null;
  list_amount: number;
  final_amount: number;
  discount_amount?: number;
  discount_percent?: number | null;
  pricing_mode?: Addon["pricing_mode"];
};

type Quote = {
  currency: string;
  subtotal: number;
  adjustment_amount: number;
  total: number;
  items: QuoteItem[];
  available_addons: Addon[];
  selected_addon_offer_ids: string[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  productName: string;
  tariffName: string;
  paymentMethodLabel: string;
  onContinue: (selection: { addonOfferIds: string[]; total: number; currency: string }) => void;
}

export function ComposableCheckoutDialog({
  open,
  onOpenChange,
  offerId,
  productName,
  tariffName,
  paymentMethodLabel,
  onContinue,
}: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    void supabase.functions.invoke("composable-checkout-quote", {
      body: { parent_offer_id: offerId, addon_offer_ids: [] },
    }).then(({ data, error: invokeError }) => {
      if (!active) return;
      if (invokeError || data?.error) {
        setError("Не удалось загрузить дополнительные модули");
        return;
      }
      const next = data as Quote;
      // Defensive fallback for stale/mixed deployments: even if the public
      // product payload incorrectly marked the offer as composable, an empty
      // canonical quote must never show the "Соберите свою программу" UI.
      // Continue immediately into the offer's ordinary configured checkout.
      if (!Array.isArray(next.available_addons) || next.available_addons.length === 0) {
        onContinue({
          addonOfferIds: [],
          total: Number(next.total ?? 0),
          currency: next.currency || "BYN",
        });
        return;
      }
      setQuote(next);
      setSelected(next.available_addons
        .filter((addon) => addon.is_required || addon.is_default_selected)
        .map((addon) => addon.addon_offer_id));
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [offerId, onContinue, open]);

  useEffect(() => {
    if (!open || !quote) return;
    const normalized = Array.from(new Set([
      ...selected,
      ...quote.available_addons.filter((addon) => addon.is_required).map((addon) => addon.addon_offer_id),
    ]));
    const timer = window.setTimeout(() => {
      setLoading(true);
      void supabase.functions.invoke("composable-checkout-quote", {
        body: { parent_offer_id: offerId, addon_offer_ids: normalized },
      }).then(({ data, error: invokeError }) => {
        if (!invokeError && !data?.error) setQuote(data as Quote);
      }).finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [offerId, open, selected]);

  const summaryLines: OrderSummaryLine[] = useMemo(() => {
    if (!quote?.items?.length) return [];
    return quote.items.map((it) => ({
      role: it.role,
      product_name: it.product_name,
      tariff_name: it.tariff_name ?? null,
      list_amount: Number(it.list_amount ?? 0),
      final_amount: Number(it.final_amount ?? 0),
      discount_amount: Number(it.discount_amount ?? 0),
      discount_percent: it.discount_percent ?? null,
      pricing_mode: it.pricing_mode,
    }));
  }, [quote]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,.94),rgba(255,247,252,.88))] p-0 shadow-[0_30px_90px_rgba(112,57,91,.18)] backdrop-blur-2xl sm:max-h-[92vh] sm:max-w-2xl">
        <div className="relative overflow-hidden rounded-[inherit] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-fuchsia-200/35 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-amber-100/55 blur-3xl" />
          <DialogHeader className="relative text-left">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/80 bg-white/65 text-fuchsia-600 shadow-sm backdrop-blur-xl sm:h-11 sm:w-11">
              <Sparkles className="h-5 w-5" />
            </div>
            <DialogTitle className="pr-7 text-[1.45rem] font-semibold leading-tight tracking-tight text-slate-800 sm:pr-0 sm:text-3xl">
              Соберите свою программу
            </DialogTitle>
            <DialogDescription className="max-w-xl text-sm leading-5 text-slate-500 sm:leading-6">
              {productName} · {tariffName}. Добавьте нужные отраслевые модули — всё оформится одной покупкой.
            </DialogDescription>
          </DialogHeader>

          {loading && !quote ? (
            <div className="flex min-h-56 items-center justify-center text-fuchsia-500">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : error ? (
            <div className="mt-6 rounded-3xl border border-rose-100 bg-rose-50/70 p-5 text-sm text-rose-700">
              {error}
            </div>
          ) : (
            <div className="relative mt-5 space-y-4 sm:mt-7">
              <AddonPicker
                addons={quote?.available_addons ?? []}
                selectedIds={selected}
                currency={quote?.currency ?? "BYN"}
                onToggle={(id, next) =>
                  setSelected((cur) =>
                    next ? [...new Set([...cur, id])] : cur.filter((x) => x !== id),
                  )
                }
                loading={loading}
                density="public"
              />

              {summaryLines.length > 0 && quote && (
                <OrderSummary
                  items={summaryLines}
                  currency={quote.currency}
                  total={quote.total}
                  subtotal={quote.subtotal}
                  adjustmentAmount={quote.adjustment_amount}
                  paymentMethodLabel={paymentMethodLabel}
                />
              )}

              <div className="rounded-3xl border border-white/80 bg-white/70 p-4 shadow-[0_16px_45px_rgba(83,57,75,.08)] backdrop-blur-xl sm:rounded-[28px] sm:p-5">
                <Button
                  disabled={!quote || loading}
                  onClick={() => quote && onContinue({
                    addonOfferIds: quote.selected_addon_offer_ids,
                    total: quote.total,
                    currency: quote.currency,
                  })}
                  className="h-12 w-full rounded-2xl border-0 bg-gradient-to-r from-fuchsia-500 to-pink-500 text-base font-semibold text-white shadow-[0_14px_34px_rgba(217,70,170,.26)] hover:from-fuchsia-600 hover:to-pink-600"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Продолжить оформление
                </Button>
                <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  <Check className="h-3.5 w-3.5" />
                  Доступ к каждому модулю предоставляется отдельно
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
