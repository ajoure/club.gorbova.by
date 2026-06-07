import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Globe2, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Phase 5-B — Offer Acquiring Settings
 *
 * Read/writes `tariff_offers.meta.acquiring`:
 *  {
 *    allowed_payment_providers: ('bepaid'|'stripe')[],
 *    default_provider: 'bepaid'|'stripe',
 *    customer_choice_enabled: false,
 *    stripe?: { account_code, price_id, product_id, currency, mode }
 *  }
 *
 * Не управляет runtime checkout. Phase 5-C добавит user-facing выбор провайдера,
 * Phase 5-D — admin override и customer_choice_enabled.
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

export function OfferAcquiringSettings({ value, onChange, isInstallment }: Props) {
  const acq = value ?? defaultAcquiring();
  const hasBepaid = acq.allowed_payment_providers.includes("bepaid");
  const hasStripe = acq.allowed_payment_providers.includes("stripe");

  const [accounts, setAccounts] = useState<StripeAccount[]>([]);
  const [loadingAcc, setLoadingAcc] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAcc(true);
      const { data } = await supabase
        .from("acquiring_connections")
        .select("account_code, account_name, test_mode, status, provider")
        .eq("provider", "stripe")
        .eq("status", "active")
        .order("account_code");
      if (!cancelled) {
        setAccounts((data ?? []) as StripeAccount[]);
        setLoadingAcc(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function update(next: Partial<OfferAcquiring>) {
    const merged: OfferAcquiring = { ...acq, ...next };
    // Auto-derive default_provider
    if (merged.allowed_payment_providers.length === 1) {
      merged.default_provider = merged.allowed_payment_providers[0];
    } else if (!merged.allowed_payment_providers.includes(merged.default_provider)) {
      merged.default_provider = "bepaid";
    }
    // Strip stripe block if Stripe disabled
    if (!merged.allowed_payment_providers.includes("stripe")) {
      delete merged.stripe;
    }
    onChange(merged);
  }

  function toggleProvider(p: AcquiringProvider, on: boolean) {
    if (p === "stripe" && on && isInstallment) {
      toast.error("Stripe пока не поддерживает рассрочку");
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
        ? (acq.stripe ?? { account_code: accounts[0]?.account_code ?? "stripe_poland", price_id: "" })
        : acq.stripe,
    });
  }

  function updateStripe(patch: Partial<OfferAcquiringStripe>) {
    const stripe = { ...(acq.stripe ?? { account_code: "stripe_poland", price_id: "" }), ...patch };
    update({ stripe });
  }

  async function handleLookup() {
    if (!acq.stripe?.price_id) {
      toast.error("Введите Stripe Price ID");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-stripe-price-lookup", {
        body: {
          price_id: acq.stripe.price_id.trim(),
          account_code: acq.stripe.account_code,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        const msg = data?.error || "lookup_failed";
        setLookupError(msg);
        toast.error(`Stripe: ${msg}`);
        // Clear derived fields on failure
        updateStripe({ product_id: null, currency: null, mode: null });
        return;
      }
      updateStripe({
        product_id: data.product_id,
        currency: data.currency,
        mode: data.mode,
      });
      toast.success(`Stripe Price подтверждён · ${data.currency} · ${data.mode}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setLookupError(msg);
      toast.error(`Stripe: ${msg}`);
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
                bePaid — карты банков Беларуси
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                BYN, локальный эквайринг. Подписки, рассрочка, ЕРИП.
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
                Stripe — карты иностранных банков
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isInstallment
                  ? "Stripe пока не поддерживает рассрочку"
                  : "EUR/USD/PLN и др. Подписки, одноразовые платежи."}
              </div>
            </div>
          </label>
        </div>

        {hasStripe && (
          <div className="border rounded-lg p-4 bg-muted/20 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Настройки Stripe</div>
              {stripeReady && (
                <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  подтверждено
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
              <Label>Stripe аккаунт</Label>
              <Select
                value={acq.stripe?.account_code ?? ""}
                onValueChange={(v) => updateStripe({ account_code: v, product_id: null, currency: null, mode: null })}
                disabled={loadingAcc || accounts.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingAcc ? "Загрузка…" : "Выберите аккаунт"} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.account_code} value={a.account_code}>
                      {a.account_name} ({a.account_code}) · {a.test_mode ? "test" : "live"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Stripe Price ID *</Label>
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
                  disabled={lookupLoading || !acq.stripe?.price_id || !acq.stripe?.account_code}
                >
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Подтвердить"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Product ID и валюту мы получим автоматически из Stripe по этому Price ID.
              </p>
              {lookupError && (
                <p className="text-xs text-destructive">
                  Не удалось подтвердить: {lookupError}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2 border-t">
              <ReadField label="Stripe Product ID" value={acq.stripe?.product_id} />
              <ReadField label="Валюта" value={acq.stripe?.currency} />
              <ReadField label="Режим" value={acq.stripe?.mode} />
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t pt-3">
          В Phase 5-B пользовательский выбор провайдера на сайте недоступен.
          {hasBepaid && hasStripe
            ? " По умолчанию используется bePaid."
            : ` Применяется единственный включённый провайдер: ${acq.allowed_payment_providers[0] === "bepaid" ? "bePaid" : "Stripe"}.`}
        </div>
      </CardContent>
    </Card>
  );
}

function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono mt-0.5 ${value ? "" : "text-muted-foreground/50"}`}>
        {value || "—"}
      </div>
    </div>
  );
}

/**
 * Save-time validator. Returns error string or null.
 */
export function validateOfferAcquiring(acq: OfferAcquiring | undefined, isInstallment: boolean): string | null {
  if (!acq) return null;
  const list = acq.allowed_payment_providers ?? [];
  if (list.length === 0) return "Выберите хотя бы один способ оплаты";
  if (isInstallment && list.includes("stripe")) return "Stripe пока не поддерживает рассрочку";
  if (list.includes("stripe")) {
    if (!acq.stripe?.price_id || acq.stripe.price_id.trim().length === 0) {
      return "Укажите Stripe Price ID";
    }
    if (!acq.stripe?.account_code) {
      return "Выберите Stripe аккаунт";
    }
  }
  return null;
}
