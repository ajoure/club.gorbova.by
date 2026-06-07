import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Globe2, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Phase 5-B + PATCH 5-B.1 — Offer Acquiring Settings (UX cleanup).
 *
 * UI скрывает технические идентификаторы Stripe (product_id, account_code, slug).
 * Лейблы переведены на пользовательский язык; в meta.acquiring сохраняются те же
 * технические поля, что и раньше (account_code, product_id, currency, mode).
 *
 * Не управляет runtime checkout. Phase 5-C добавит user-facing выбор провайдера.
 */

export type AcquiringProvider = "bepaid" | "stripe";

export interface OfferAcquiringStripe {
  account_code: string;
  price_id: string;
  product_id?: string | null;
  currency?: string | null;
  mode?: "test" | "live" | null;
}

export interface OfferAcquiring {
  allowed_payment_providers: AcquiringProvider[];
  default_provider: AcquiringProvider;
  customer_choice_enabled: boolean;
  stripe?: OfferAcquiringStripe;
}

interface StripeAccount {
  account_code: string;
  account_name: string;
  test_mode: boolean;
  is_default?: boolean;
}

interface Props {
  value: OfferAcquiring | undefined;
  onChange: (next: OfferAcquiring) => void;
  isInstallment: boolean;
}

function defaultAcquiring(): OfferAcquiring {
  return {
    allowed_payment_providers: ["bepaid"],
    default_provider: "bepaid",
    customer_choice_enabled: false,
  };
}

function modeLabel(mode?: string | null) {
  if (mode === "test") return "Тестовый режим";
  if (mode === "live") return "Боевой режим";
  return null;
}

export function OfferAcquiringSettings({ value, onChange, isInstallment }: Props) {
  const acq = value ?? defaultAcquiring();
  const hasBepaid = acq.allowed_payment_providers.includes("bepaid");
  const hasStripe = acq.allowed_payment_providers.includes("stripe");

  const [accounts, setAccounts] = useState<StripeAccount[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("acquiring_connections")
        .select("account_code, account_name, test_mode, status, provider, is_default")
        .eq("provider", "stripe")
        .eq("status", "active")
        .order("is_default", { ascending: false })
        .order("account_code");
      if (!cancelled) setAccounts((data ?? []) as StripeAccount[]);
    })();
    return () => { cancelled = true; };
  }, []);

  function defaultAccountCode(): string {
    return accounts.find((a) => a.is_default)?.account_code
      ?? accounts[0]?.account_code
      ?? "stripe_poland";
  }

  function update(next: Partial<OfferAcquiring>) {
    const merged: OfferAcquiring = { ...acq, ...next };
    if (merged.allowed_payment_providers.length === 1) {
      merged.default_provider = merged.allowed_payment_providers[0];
    } else if (!merged.allowed_payment_providers.includes(merged.default_provider)) {
      merged.default_provider = "bepaid";
    }
    if (!merged.allowed_payment_providers.includes("stripe")) {
      delete merged.stripe;
    }
    onChange(merged);
  }

  function toggleProvider(p: AcquiringProvider, on: boolean) {
    if (p === "stripe" && on && isInstallment) {
      toast.error("Иностранные карты пока не поддерживают рассрочку");
      return;
    }
    const set = new Set(acq.allowed_payment_providers);
    if (on) set.add(p); else set.delete(p);
    const next = Array.from(set) as AcquiringProvider[];
    if (next.length === 0) {
      toast.error("Выберите хотя бы один способ оплаты");
      return;
    }
    update({
      allowed_payment_providers: next,
      stripe: p === "stripe" && on
        ? (acq.stripe ?? { account_code: defaultAccountCode(), price_id: "" })
        : acq.stripe,
    });
  }

  function updateStripe(patch: Partial<OfferAcquiringStripe>) {
    const stripe: OfferAcquiringStripe = {
      ...(acq.stripe ?? { account_code: defaultAccountCode(), price_id: "" }),
      ...patch,
    };
    update({ stripe });
  }

  function updateMode(mode: "test" | "live") {
    // Режим выбирается администратором — соответствующий аккаунт acquiring_connections
    // подбираем автоматически по test_mode. Если подходящего нет — оставляем текущий.
    const target = accounts.find((a) => (mode === "test" ? a.test_mode : !a.test_mode));
    updateStripe({
      mode,
      account_code: target?.account_code ?? acq.stripe?.account_code ?? defaultAccountCode(),
      // При смене режима lookup должен быть повторён.
      product_id: null,
    });
  }

  async function handleLookup() {
    if (!acq.stripe?.price_id) {
      toast.error("Введите код тарифа Stripe");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const accountCode = acq.stripe.account_code || defaultAccountCode();
      const { data, error } = await supabase.functions.invoke("admin-stripe-price-lookup", {
        body: { price_id: acq.stripe.price_id.trim(), account_code: accountCode },
      });
      if (error) throw error;
      if (!data?.ok) {
        const msg = data?.error || "lookup_failed";
        setLookupError(msg);
        toast.error(`Не удалось подтвердить код тарифа: ${msg}`);
        updateStripe({ product_id: null, currency: null, mode: null });
        return;
      }
      updateStripe({
        account_code: accountCode,
        product_id: data.product_id,
        currency: data.currency,
        mode: data.mode,
      });
      toast.success("Тариф Stripe подключён");
    } catch (e: any) {
      const msg = e?.message || String(e);
      setLookupError(msg);
      toast.error(`Не удалось подтвердить код тарифа: ${msg}`);
    } finally {
      setLookupLoading(false);
    }
  }

  const stripeReady = Boolean(acq.stripe?.product_id && acq.stripe?.currency);
  const stripeDirty = Boolean(acq.stripe?.price_id) && !stripeReady;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">Способы приёма оплаты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
            <Checkbox
              checked={hasBepaid}
              onCheckedChange={(v) => toggleProvider("bepaid", Boolean(v))}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                Принимать белорусские карты
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Visa / Mastercard банков Беларуси. BYN, подписки, рассрочка, ЕРИП.
              </div>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3 rounded-lg border ${isInstallment ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/50 cursor-pointer"}`}>
            <Checkbox
              checked={hasStripe}
              disabled={isInstallment}
              onCheckedChange={(v) => toggleProvider("stripe", Boolean(v))}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-indigo-500" />
                Принимать иностранные карты
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isInstallment
                  ? "Иностранные карты пока не поддерживают рассрочку"
                  : "Visa / Mastercard банков Европы, США и других стран."}
              </div>
            </div>
          </label>
        </div>

        {hasStripe && (
          <div className="border rounded-lg p-4 bg-muted/20 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Приём оплаты иностранными картами</div>
              {stripeReady && (
                <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  подключено
                </Badge>
              )}
              {stripeDirty && (
                <Badge variant="outline" className="text-amber-700 border-amber-300">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  не подтверждено
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <Label>Код тарифа Stripe *</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="price_..."
                  value={acq.stripe?.price_id ?? ""}
                  onChange={(e) =>
                    updateStripe({
                      price_id: e.target.value,
                      product_id: null,
                      currency: null,
                      mode: null,
                    })
                  }
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleLookup}
                  disabled={lookupLoading || !acq.stripe?.price_id}
                >
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Подтвердить"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Валюту и режим работы мы определим автоматически по коду тарифа.
              </p>
              {lookupError && (
                <p className="text-xs text-destructive">
                  Не удалось подтвердить: {lookupError}
                </p>
              )}
            </div>

            {stripeReady && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  Тариф Stripe подключён
                </div>
                <div className="text-xs text-emerald-900/80 dark:text-emerald-100/80 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-6">
                  <div>Валюта оплаты:</div>
                  <div className="font-medium">{acq.stripe?.currency?.toUpperCase() || "—"}</div>
                  <div>Режим:</div>
                  <div className="font-medium">{modeLabel(acq.stripe?.mode) || "—"}</div>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs">Режим работы</Label>
              <RadioGroup
                value={acq.stripe?.mode ?? ""}
                onValueChange={(v) => updateMode(v as "test" | "live")}
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="test" id="stripe-mode-test" />
                  Тестовый режим
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <RadioGroupItem value="live" id="stripe-mode-live" />
                  Боевой режим
                </label>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                Режим подставится автоматически после проверки кода тарифа. Можно изменить вручную.
              </p>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t pt-3">
          {hasBepaid && hasStripe
            ? "Покупатель сможет выбрать карту белорусского или иностранного банка."
            : hasBepaid
              ? "Оплата принимается только белорусскими картами."
              : "Оплата принимается только иностранными картами."}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Save-time validator. Returns error string or null.
 */
export function validateOfferAcquiring(acq: OfferAcquiring | undefined, isInstallment: boolean): string | null {
  if (!acq) return null;
  const list = acq.allowed_payment_providers ?? [];
  if (list.length === 0) return "Выберите хотя бы один способ оплаты";
  if (isInstallment && list.includes("stripe")) return "Иностранные карты пока не поддерживают рассрочку";
  if (list.includes("stripe")) {
    if (!acq.stripe?.price_id || acq.stripe.price_id.trim().length === 0) {
      return "Укажите код тарифа Stripe";
    }
    if (!acq.stripe?.account_code) {
      // Внутреннее требование — заполняем при первом включении Stripe автоматически,
      // но валидация остаётся как safety-net.
      return "Не удалось определить Stripe-подключение";
    }
  }
  return null;
}
