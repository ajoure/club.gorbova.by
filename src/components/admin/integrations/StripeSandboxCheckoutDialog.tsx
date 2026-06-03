// PATCH Phase 2 (fix) — Admin-only Stripe Sandbox Checkout dialog.
//
// Scope:
//   - Admin selects product (only with active pay_now offers) → tariff → offer
//   - Sandbox fallback: manual amount when offer is absent
//   - Picks currency (USD/EUR/PLN/BYN — no GBP/RUB)
//   - Calls stripe-admin-sandbox-checkout edge function
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
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

const CURRENCIES = ["USD", "EUR", "PLN", "BYN"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function StripeSandboxCheckoutDialog({ open, onOpenChange, connection }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [tariffs, setTariffs] = useState<TariffRow[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);

  const [productId, setProductId] = useState<string>("");
  const [tariffId, setTariffId] = useState<string>("");
  const [offerId, setOfferId] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USD");
  const [email, setEmail] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [sandboxFallback, setSandboxFallback] = useState<boolean>(false);

  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingTariffs, setLoadingTariffs] = useState(false);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setProductId("");
      setTariffId("");
      setOfferId("");
      setCurrency("USD");
      setEmail("");
      setAmount("");
      setSandboxFallback(false);
      setTariffs([]);
      setOffers([]);
    }
  }, [open]);

  // Load Products V2 that actually have active pay_now offers.
  // NOTE: tariffs.product_id points to products_v2.id, not legacy products.id.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingProducts(true);
      try {
        const { data: offerRows, error: oErr } = await supabase
          .from("tariff_offers")
          .select("tariff_id")
          .eq("is_active", true)
          .eq("offer_type", "pay_now");
        if (oErr) throw oErr;
        const tariffIds = Array.from(
          new Set((offerRows ?? []).map((r: any) => r.tariff_id).filter(Boolean)),
        );
        if (tariffIds.length === 0) {
          if (!cancelled) setProducts([]);
          return;
        }
        const { data: tRows, error: tErr } = await supabase
          .from("tariffs")
          .select("product_id")
          .in("id", tariffIds)
          .eq("is_active", true);
        if (tErr) throw tErr;
        const productIds = Array.from(
          new Set((tRows ?? []).map((r: any) => r.product_id).filter(Boolean)),
        );
        if (productIds.length === 0) {
          if (!cancelled) setProducts([]);
          return;
        }
        const { data: pRows, error: pErr } = await supabase
          .from("products_v2")
          .select("id, name")
          .in("id", productIds)
          .eq("is_active", true)
          .order("name");
        if (pErr) throw pErr;
        if (!cancelled) setProducts((pRows ?? []) as ProductRow[]);
      } catch (e) {
        toast.error(normalizeEdgeFunctionError(e, "Не удалось загрузить продукты"));
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load tariffs (only those with active pay_now offers) when product changes
  useEffect(() => {
    setTariffId("");
    setOfferId("");
    setTariffs([]);
    setOffers([]);
    setSandboxFallback(false);
    if (!productId) return;
    let cancelled = false;
    (async () => {
      setLoadingTariffs(true);
      try {
        const { data: tRows, error: tErr } = await supabase
          .from("tariffs")
          .select("id, product_id, name, display_order")
          .eq("product_id", productId)
          .eq("is_active", true)
          .order("display_order");
        if (tErr) throw tErr;
        const ids = (tRows ?? []).map((r: any) => r.id);
        if (ids.length === 0) {
          if (!cancelled) setTariffs([]);
          return;
        }
        const { data: oRows, error: oErr } = await supabase
          .from("tariff_offers")
          .select("tariff_id")
          .in("tariff_id", ids)
          .eq("is_active", true)
          .eq("offer_type", "pay_now");
        if (oErr) throw oErr;
        const withOffers = new Set((oRows ?? []).map((r: any) => r.tariff_id));
        const filtered = (tRows ?? []).filter((r: any) => withOffers.has(r.id));
        if (!cancelled) setTariffs(filtered as TariffRow[]);
      } catch (e) {
        toast.error(normalizeEdgeFunctionError(e, "Не удалось загрузить тарифы"));
      } finally {
        if (!cancelled) setLoadingTariffs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // Load offers when tariff changes
  useEffect(() => {
    setOfferId("");
    setOffers([]);
    setSandboxFallback(false);
    if (!tariffId) return;
    let cancelled = false;
    (async () => {
      setLoadingOffers(true);
      try {
        const { data, error } = await supabase
          .from("tariff_offers")
          .select("id, tariff_id, button_label, amount, is_active")
          .eq("tariff_id", tariffId)
          .eq("is_active", true)
          .eq("offer_type", "pay_now")
          .order("sort_order");
        if (error) throw error;
        const rows = (data ?? []) as OfferRow[];
        if (cancelled) return;
        setOffers(rows);
        if (rows.length > 0) {
          setOfferId(rows[0].id);
        } else {
          setSandboxFallback(true);
        }
      } catch (e) {
        toast.error(normalizeEdgeFunctionError(e, "Не удалось загрузить кнопки оплаты"));
      } finally {
        if (!cancelled) setLoadingOffers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tariffId]);

  // Auto-fill amount from selected offer
  const selectedOffer = useMemo(
    () => offers.find((o) => o.id === offerId) ?? null,
    [offers, offerId],
  );
  useEffect(() => {
    if (selectedOffer) setAmount(String(Number(selectedOffer.amount).toFixed(2)));
  }, [selectedOffer]);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const emailValid = email.trim() === "" || EMAIL_RE.test(email.trim());

  const canSubmit =
    !!connection &&
    !!productId &&
    (!!offerId || sandboxFallback) &&
    !!currency &&
    amountValid &&
    emailValid &&
    !submitting;

  const onSubmit = async () => {
    if (!connection) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "stripe-admin-sandbox-checkout",
        {
          body: {
            product_id: productId,
            tariff_id: tariffId || undefined,
            offer_id: offerId || undefined,
            amount: amountNum,
            currency,
            customer_email: email.trim() || undefined,
            account_code: connection.account_code,
            sandbox_fallback: !offerId && sandboxFallback,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) {
        const code = data?.code ?? "";
        if (code === "stripe_currency_not_supported") {
          toast.error(
            `Stripe не принял валюту ${currency} для этого аккаунта. Выберите другую валюту.`,
          );
        } else {
          toast.error(data?.message ?? data?.error ?? "Не удалось открыть Stripe Checkout");
        }
        return;
      }
      toast.success(`Sandbox order ${data.order_number ?? ""} создан. Открываем Stripe…`);
      window.open(data.url as string, "_blank", "noopener,noreferrer");
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Ошибка sandbox-checkout"));
    } finally {
      setSubmitting(false);
    }
  };

  const noProducts = !loadingProducts && products.length === 0;
  const noTariffs = !!productId && !loadingTariffs && tariffs.length === 0;
  const noOffers = !!tariffId && !loadingOffers && offers.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Тестовая оплата Stripe</DialogTitle>
          <DialogDescription>
            Создаёт sandbox <code>orders_v2</code> (provider=stripe) и открывает Stripe Checkout.
            Используйте карту <code>4242 4242 4242 4242</code>, любую будущую дату и CVC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Product */}
          <div className="space-y-1.5">
            <Label>Продукт</Label>
            <Select
              value={productId}
              onValueChange={setProductId}
              disabled={loadingProducts || submitting || noProducts}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingProducts
                      ? "Загрузка…"
                      : noProducts
                        ? "Нет продуктов с активными офферами"
                        : "Выберите продукт"
                  }
                />
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

          {/* Tariff */}
          <div className="space-y-1.5">
            <Label>Тариф</Label>
            <Select
              value={tariffId}
              onValueChange={setTariffId}
              disabled={!productId || loadingTariffs || submitting || noTariffs}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !productId
                      ? "Сначала продукт"
                      : loadingTariffs
                        ? "Загрузка…"
                        : noTariffs
                          ? "У продукта нет активных тарифов"
                          : "Выберите тариф"
                  }
                />
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

          {/* Offer */}
          <div className="space-y-1.5">
            <Label>Кнопка оплаты (offer)</Label>
            <Select
              value={offerId}
              onValueChange={setOfferId}
              disabled={!tariffId || loadingOffers || submitting || noOffers}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !tariffId
                      ? "Сначала тариф"
                      : loadingOffers
                        ? "Загрузка…"
                        : noOffers
                          ? "Нет активных офферов"
                          : "Выберите оффер"
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {offers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.button_label} — {Number(o.amount).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {noOffers && (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="sandbox-fallback"
                  checked={sandboxFallback}
                  onCheckedChange={(v) => setSandboxFallback(!!v)}
                  disabled={submitting}
                />
                <label
                  htmlFor="sandbox-fallback"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  Sandbox fallback: ввести сумму вручную (offer отсутствует)
                </label>
              </div>
            )}
          </div>

          {/* Currency + Amount */}
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
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10.00"
                disabled={submitting}
              />
              {amount !== "" && !amountValid && (
                <p className="text-xs text-destructive">Сумма должна быть больше 0</p>
              )}
            </div>
          </div>

          {currency === "BYN" && (
            <div className="flex gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
              <p>
                BYN выбран как бизнес-валюта. Stripe может конвертировать/обработать валюту
                в зависимости от настроек аккаунта. Если Stripe отклонит валюту, checkout
                вернёт ошибку.
              </p>
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <Label>Email покупателя (опционально)</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="test@example.com"
              disabled={submitting}
            />
            {!emailValid && (
              <p className="text-xs text-destructive">Некорректный email</p>
            )}
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
