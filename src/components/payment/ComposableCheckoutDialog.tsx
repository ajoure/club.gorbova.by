import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

type Quote = {
  currency: string;
  subtotal: number;
  adjustment_amount: number;
  total: number;
  available_addons: Addon[];
  selected_addon_offer_ids: string[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  productName: string;
  tariffName: string;
  onContinue: (selection: { addonOfferIds: string[]; total: number; currency: string }) => void;
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("ru-BY", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

export function ComposableCheckoutDialog({
  open,
  onOpenChange,
  offerId,
  productName,
  tariffName,
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
      setQuote(next);
      setSelected(next.available_addons
        .filter((addon) => addon.is_required || addon.is_default_selected)
        .map((addon) => addon.addon_offer_id));
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [offerId, open]);

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

  const requiredIds = useMemo(() =>
    new Set(quote?.available_addons.filter((addon) => addon.is_required).map((addon) => addon.addon_offer_id) ?? []),
  [quote]);

  const toggle = (id: string) => {
    if (requiredIds.has(id)) return;
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,.94),rgba(255,247,252,.88))] p-0 shadow-[0_30px_90px_rgba(112,57,91,.18)] backdrop-blur-2xl sm:max-w-2xl">
        <div className="relative overflow-hidden rounded-[inherit] px-5 py-6 sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-fuchsia-200/35 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-amber-100/55 blur-3xl" />
          <DialogHeader className="relative text-left">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/65 text-fuchsia-600 shadow-sm backdrop-blur-xl">
              <Sparkles className="h-5 w-5" />
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-slate-800 sm:text-3xl">
              Соберите свою программу
            </DialogTitle>
            <DialogDescription className="max-w-xl text-sm leading-6 text-slate-500">
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
            <div className="relative mt-7 space-y-3">
              {quote?.available_addons.map((addon) => {
                const checked = selected.includes(addon.addon_offer_id) || addon.is_required;
                const finalPrice = addon.pricing_mode === "free"
                  ? 0
                  : addon.pricing_mode === "fixed_price"
                    ? Number(addon.fixed_amount ?? addon.list_amount)
                    : addon.pricing_mode === "percent_discount"
                      ? addon.list_amount * (1 - Number(addon.discount_percent ?? 0) / 100)
                      : addon.list_amount;
                return (
                  <button
                    type="button"
                    key={addon.addon_offer_id}
                    onClick={() => toggle(addon.addon_offer_id)}
                    className={`group flex w-full items-center gap-4 rounded-3xl border p-4 text-left transition-all sm:p-5 ${
                      checked
                        ? "border-fuchsia-200/90 bg-white/85 shadow-[0_12px_34px_rgba(196,74,154,.10)]"
                        : "border-white/80 bg-white/45 hover:border-fuchsia-100 hover:bg-white/75"
                    }`}
                  >
                    <Checkbox checked={checked} disabled={addon.is_required} className="h-5 w-5 rounded-md border-fuchsia-200 data-[state=checked]:border-fuchsia-500 data-[state=checked]:bg-fuchsia-500" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800">{addon.addon_product_name}</div>
                      <div className="mt-1 text-xs text-slate-500">{addon.addon_tariff_name}</div>
                    </div>
                    <div className="text-right">
                      {finalPrice === 0 ? (
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">В подарок</span>
                      ) : (
                        <div className="font-semibold text-slate-800">{money(finalPrice, quote.currency)}</div>
                      )}
                      {addon.is_required && <div className="mt-1 text-[11px] text-fuchsia-600">Включён в тариф</div>}
                    </div>
                  </button>
                );
              })}

              {quote?.available_addons.length === 0 && (
                <div className="rounded-3xl border border-white/80 bg-white/60 p-5 text-sm text-slate-500">
                  Для этого тарифа дополнительные модули пока не настроены.
                </div>
              )}

              <div className="mt-6 rounded-[28px] border border-white/80 bg-white/70 p-5 shadow-[0_16px_45px_rgba(83,57,75,.08)] backdrop-blur-xl sm:p-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[.16em] text-slate-400">Итого</div>
                    <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                      {quote ? money(quote.total, quote.currency) : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Одна оплата
                  </div>
                </div>
                <Button
                  disabled={!quote || loading}
                  onClick={() => quote && onContinue({
                    addonOfferIds: quote.selected_addon_offer_ids,
                    total: quote.total,
                    currency: quote.currency,
                  })}
                  className="mt-5 h-12 w-full rounded-2xl border-0 bg-gradient-to-r from-fuchsia-500 to-pink-500 text-base font-semibold text-white shadow-[0_14px_34px_rgba(217,70,170,.26)] hover:from-fuchsia-600 hover:to-pink-600"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Продолжить оформление
                </Button>
                <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-slate-400">
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
