import { useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Globe2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  useAcquiringProfiles,
  filterByProvider,
  type AcquiringProfile,
} from "@/hooks/admin/useAcquiringProfiles";

/**
 * PATCH 5-B.3 — UI-only: только бизнес-настройки кнопки оплаты.
 *
 * Что осталось:
 *  - bePaid checkbox + select подключения (integration_instances WHERE provider='bepaid').
 *  - Stripe checkbox + select подключения (acquiring_connections WHERE provider='stripe').
 *  - test/live — read-only бейдж.
 *
 * Что убрано (по PATCH 5-B.3):
 *  - блок «Дополнительные настройки Stripe»;
 *  - поле «Код тарифа Stripe» и кнопка «Проверить»;
 *  - служебный ID продукта / валюта / mode-грид.
 *
 * Сохранение price_id в meta остаётся (legacy), просто не редактируется здесь.
 * Если для подписки Stripe price_id отсутствует — save заблокирован валидатором
 * с понятным сообщением «обратитесь к интегратору».
 *
 * Runtime, public-checkout, webhooks, grant-access — не тронуты.
 */

export type AcquiringProvider = "bepaid" | "stripe";

export interface OfferAcquiringStripe {
  account_code: string;
  price_id: string;
  product_id?: string | null;
  currency?: string | null;
  mode?: "test" | "live" | null;
}

export interface OfferAcquiringBepaid {
  account_code: string;
  shop_id?: string | null;
}

export interface OfferAcquiring {
  allowed_payment_providers: AcquiringProvider[];
  default_provider: AcquiringProvider;
  customer_choice_enabled: boolean;
  bepaid?: OfferAcquiringBepaid;
  stripe?: OfferAcquiringStripe;
}

interface Props {
  value: OfferAcquiring | undefined;
  onChange: (next: OfferAcquiring) => void;
  isInstallment: boolean;
  isSubscription: boolean;
}

function defaultAcquiring(): OfferAcquiring {
  return {
    allowed_payment_providers: ["bepaid"],
    default_provider: "bepaid",
    customer_choice_enabled: false,
  };
}

function modeBadge(testMode: boolean) {
  return testMode ? "Тестовое подключение" : "Боевое подключение";
}

export function OfferAcquiringSettings({ value, onChange, isInstallment, isSubscription }: Props) {
  const acq = value ?? defaultAcquiring();
  const hasBepaid = acq.allowed_payment_providers.includes("bepaid");
  const hasStripe = acq.allowed_payment_providers.includes("stripe");

  const { data: profiles, isLoading: profilesLoading } = useAcquiringProfiles();
  const connectionsLoaded = !profilesLoading;

  const bepaidConnections = useMemo<AcquiringProfile[]>(
    () => filterByProvider(profiles, "bepaid"),
    [profiles],
  );
  const stripeConnections = useMemo<AcquiringProfile[]>(
    () => filterByProvider(profiles, "stripe"),
    [profiles],
  );

  // Auto-populate bepaid.account_code
  useEffect(() => {
    if (!connectionsLoaded || !hasBepaid || acq.bepaid?.account_code) return;
    if (bepaidConnections.length === 0) return;
    const def = bepaidConnections.find((c) => c.is_default) ?? bepaidConnections[0];
    update({ bepaid: { account_code: def.account_code, shop_id: def.shop_id ?? null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsLoaded, hasBepaid]);

  // Auto-populate stripe.account_code
  useEffect(() => {
    if (!connectionsLoaded || !hasStripe || acq.stripe?.account_code) return;
    if (stripeConnections.length === 0) return;
    const def = stripeConnections.find((c) => c.is_default) ?? stripeConnections[0];
    updateStripe({ account_code: def.account_code, mode: def.test_mode ? "test" : "live" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsLoaded, hasStripe]);

  const selectedBepaid = useMemo(
    () => bepaidConnections.find((c) => c.account_code === acq.bepaid?.account_code),
    [bepaidConnections, acq.bepaid?.account_code],
  );
  const selectedStripe = useMemo(
    () => stripeConnections.find((c) => c.account_code === acq.stripe?.account_code),
    [stripeConnections, acq.stripe?.account_code],
  );

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
    if (!merged.allowed_payment_providers.includes("bepaid")) {
      delete merged.bepaid;
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
    update({ allowed_payment_providers: next });
  }

  function updateStripe(patch: Partial<OfferAcquiringStripe>) {
    const base: OfferAcquiringStripe = acq.stripe ?? { account_code: "", price_id: "" };
    update({ stripe: { ...base, ...patch } });
  }

  function changeStripeConnection(accountCode: string) {
    const conn = stripeConnections.find((c) => c.account_code === accountCode);
    updateStripe({
      account_code: accountCode,
      mode: conn ? (conn.test_mode ? "test" : "live") : null,
    });
  }

  function changeBepaidConnection(accountCode: string) {
    const conn = bepaidConnections.find((c) => c.account_code === accountCode);
    update({
      bepaid: {
        account_code: accountCode,
        shop_id: conn?.shop_id ?? null,
      },
    });
  }

  // Phase 6-G: Stripe price_id больше не редактируется вручную и не блокирует save.
  // Под Stripe-блоком показываем нейтральный info при subscription, если подключение выбрано.
  const showStripeSubscriptionInfo =
    hasStripe && isSubscription && Boolean(acq.stripe?.account_code);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">Способы приёма оплаты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* === bePaid === */}
        <div className="rounded-lg border p-3 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={hasBepaid}
              onCheckedChange={(v) => toggleProvider("bepaid", Boolean(v))}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                Принимать белорусские карты <span className="text-xs text-muted-foreground">(bePaid)</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Visa / Mastercard банков Беларуси. BYN, подписки, рассрочка, ЕРИП.
              </div>
            </div>
          </label>

          {hasBepaid && (
            <div className="pl-7 space-y-2">
              {!connectionsLoaded ? (
                <div className="text-xs text-muted-foreground">Загрузка подключений…</div>
              ) : bepaidConnections.length === 0 ? (
                <div className="text-xs text-destructive border border-destructive/40 rounded p-2 bg-destructive/5">
                  Нет активного подключения bePaid. Добавьте подключение в настройках интеграций.
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-xs whitespace-nowrap">Подключение:</Label>
                  <Select
                    value={acq.bepaid?.account_code ?? ""}
                    onValueChange={changeBepaidConnection}
                  >
                    <SelectTrigger className="flex-1 min-w-[220px]">
                      <SelectValue placeholder="Выбрать подключение" />
                    </SelectTrigger>
                    <SelectContent>
                      {bepaidConnections.map((c) => (
                        <SelectItem key={c.account_code} value={c.account_code}>
                          {c.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedBepaid && (
                    <Badge variant="outline" className="text-xs">
                      {modeBadge(selectedBepaid.test_mode)}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* === Stripe === */}
        <div className={`rounded-lg border p-3 space-y-3 ${isInstallment ? "opacity-60" : ""}`}>
          <label className={`flex items-start gap-3 ${isInstallment ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <Checkbox
              checked={hasStripe}
              disabled={isInstallment}
              onCheckedChange={(v) => toggleProvider("stripe", Boolean(v))}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-indigo-500" />
                Принимать иностранные карты <span className="text-xs text-muted-foreground">(Stripe)</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isInstallment
                  ? "Иностранные карты пока не поддерживают рассрочку"
                  : "Visa / Mastercard банков Европы, США и других стран."}
              </div>
            </div>
          </label>

          {hasStripe && !isInstallment && (
            <div className="pl-7 space-y-3">
              {!connectionsLoaded ? (
                <div className="text-xs text-muted-foreground">Загрузка подключений…</div>
              ) : stripeConnections.length === 0 ? (
                <div className="text-xs text-destructive border border-destructive/40 rounded p-2 bg-destructive/5">
                  Нет активного подключения Stripe. Добавьте подключение в настройках интеграций.
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-xs whitespace-nowrap">Подключение:</Label>
                  <Select
                    value={acq.stripe?.account_code ?? ""}
                    onValueChange={changeStripeConnection}
                  >
                    <SelectTrigger className="flex-1 min-w-[220px]">
                      <SelectValue placeholder="Выбрать подключение" />
                    </SelectTrigger>
                    <SelectContent>
                      {stripeConnections.map((c) => (
                        <SelectItem key={c.account_code} value={c.account_code}>
                          {c.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedStripe && (
                    <Badge variant="outline" className="text-xs">
                      {modeBadge(selectedStripe.test_mode)}
                    </Badge>
                  )}
                </div>
              )}

              {subscriptionStripeNotConfigured && (
                <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200 border border-amber-300/60 rounded p-2 bg-amber-50/60 dark:bg-amber-950/20">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Для подписки через Stripe не настроен тариф Stripe. Настройка тарифов Stripe
                    будет доступна в разделе «Интеграции → Stripe → Тарифы». Сохранение этого
                    способа оплаты сейчас недоступно — снимите галочку или отключите подписку.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

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
export function validateOfferAcquiring(
  acq: OfferAcquiring | undefined,
  isInstallment: boolean,
  isSubscription: boolean = false,
): string | null {
  if (!acq) return null;
  const list = acq.allowed_payment_providers ?? [];
  if (list.length === 0) return "Выберите хотя бы один способ оплаты";
  if (isInstallment && list.includes("stripe")) {
    return "Иностранные карты пока не поддерживают рассрочку";
  }
  if (list.includes("bepaid")) {
    if (!acq.bepaid?.account_code) {
      return "Выберите подключение для приёма белорусских карт";
    }
  }
  if (list.includes("stripe")) {
    if (!acq.stripe?.account_code) {
      return "Выберите подключение для приёма иностранных карт";
    }
    if (isSubscription && (!acq.stripe?.price_id || acq.stripe.price_id.trim().length === 0)) {
      return "Для подписки через Stripe не настроен тариф Stripe. Настройка тарифов Stripe будет доступна в разделе «Интеграции → Stripe → Тарифы».";
    }
  }
  return null;
}
