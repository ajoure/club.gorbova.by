// PATCH Phase 2 — Admin-only Stripe Sandbox Checkout dialog.
//
// Scope:
//   - Admin selects product → tariff → offer
//   - Picks currency (sandbox)
//   - Calls stripe-admin-sandbox-checkout edge function
//   - Opens Stripe Checkout in a new tab
//
// FREEZE: no bePaid changes, no payment_links, no normal "Ссылка на оплату" flow.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import type { AcquiringConnectionRow } from "./StripeConnectionDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: AcquiringConnectionRow | null;
}

interface ProductRow {
  id: string;
  name: string;
}
interface TariffRow {
  id: string;
  product_id: string;
  name: string;
}
interface OfferRow {
  id: string;
  tariff_id: string;
  button_label: string;
  amount: number;
  is_active: boolean | null;
}

const CURRENCIES = ["USD", "EUR", "PLN", "GBP"] as const;

export function StripeSandboxCheckoutDialog({ open, onOpenChange, connection }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [tariffs, setTariffs] = useState<TariffRow[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);

  const [productId, setProductId] = useState<string>("");
  const [tariffId, setTariffId] = useState<string>("");
  const [offerId, setOfferId] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load products on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("products")
          .select("id, name")
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        if (!cancelled) setProducts((data ?? []) as ProductRow[]);
      } catch (e) {
        toast.error(normalizeEdgeFunctionError(e, "Не удалось загрузить продукты"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load tariffs when product changes
  useEffect(() => {
    setTariffId("");
    setOfferId("");
    setTariffs([]);
    setOffers([]);
    if (!productId) return;
    (async () => {
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, product_id, name")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("display_order");
      if (error) {
        toast.error(normalizeEdgeFunctionError(error, "Не удалось загрузить тарифы"));
        return;
      }
      setTariffs((data ?? []) as TariffRow[]);
    })();
  }, [productId]);

  // Load offers when tariff changes
  useEffect(() => {
    setOfferId("");
    setOffers([]);
    if (!tariffId) return;
    (async () => {
      const { data, error } = await supabase
        .from("tariff_offers")
        .select("id, tariff_id, button_label, amount, is_active")
        .eq("tariff_id", tariffId)
        .eq("is_active", true)
        .eq("offer_type", "pay_now")
        .order("sort_order");
      if (error) {
        toast.error(normalizeEdgeFunctionError(error, "Не удалось загрузить кнопки оплаты"));
        return;
      }
      setOffers((data ?? []) as OfferRow[]);
    })();
  }, [tariffId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setProductId("");
      setTariffId("");
      setOfferId("");
      setCurrency("USD");
      setEmail("");
    }
  }, [open]);

  const selectedOffer = useMemo(() => offers.find((o) => o.id === offerId) ?? null, [offers, offerId]);

  const canSubmit = !!(connection && productId && tariffId && offerId && currency && !submitting);

  const onSubmit = async () => {
    if (!connection) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-admin-sandbox-checkout", {
        body: {
          product_id: productId,
          tariff_id: tariffId,
          offer_id: offerId,
          currency,
          customer_email: email || undefined,
          account_code: connection.account_code,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.message ?? data?.error ?? "Не удалось открыть Stripe Checkout");
        return;
      }
      toast.success(`Sandbox order ${data.order_number ?? ""} создан. Открываем Stripe…`);
      const url = data.url as string;
      window.open(url, "_blank", "noopener,noreferrer");
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Ошибка sandbox-checkout"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Тестовая оплата Stripe</DialogTitle>
          <DialogDescription>
            Создаёт sandbox <code>orders_v2</code> (provider=stripe) и открывает Stripe Checkout.
            Используйте карту <code>4242 4242 4242 4242</code>, любую будущую дату и CVC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Продукт</Label>
            <Select value={productId} onValueChange={setProductId} disabled={loading || submitting}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Загрузка…" : "Выберите продукт"} />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Тариф</Label>
            <Select
              value={tariffId}
              onValueChange={setTariffId}
              disabled={!productId || submitting}
            >
              <SelectTrigger>
                <SelectValue placeholder={productId ? "Выберите тариф" : "Сначала продукт"} />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {tariffs.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Кнопка оплаты (offer)</Label>
            <Select value={offerId} onValueChange={setOfferId} disabled={!tariffId || submitting}>
              <SelectTrigger>
                <SelectValue placeholder={tariffId ? "Выберите оффер" : "Сначала тариф"} />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {offers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.button_label} — {Number(o.amount).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Валюта (sandbox)</Label>
              <Select value={currency} onValueChange={setCurrency} disabled={submitting}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Сумма</Label>
              <Input
                readOnly
                value={selectedOffer ? `${Number(selectedOffer.amount).toFixed(2)} ${currency}` : "—"}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Email покупателя (опционально)</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="test@example.com"
              disabled={submitting}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Подключение: <strong>{connection?.account_name}</strong> ·{" "}
            <strong>{connection?.account_code}</strong> · test_mode
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            Создать sandbox order и открыть Stripe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
