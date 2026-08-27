import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Link2, Copy, ExternalLink, Loader2, Layers, Tag, CheckCircle, Send,
  AlertTriangle, MousePointerClick, CreditCard, RefreshCw, Info, Users,
  Check, ChevronsUpDown
} from "lucide-react";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { AddonPicker } from "@/components/checkout/AddonPicker";
import { OrderSummary, type OrderSummaryLine } from "@/components/checkout/OrderSummary";
import { InvoiceDeliverySuccess } from "@/components/payment/InvoiceDeliverySuccess";

import { useTariffOffers, type TariffOffer } from "@/hooks/useTariffOffers";
import { useHasRoleV2 } from "@/hooks/useHasRoleV2";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { formatPaymentTimeIANA } from "@/lib/formatPaymentTime";
import { cn } from "@/lib/utils";
import { resolveAvailableProviders } from "@/utils/currencyProviderResolver";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import {
  mapSiblingAddonOfferIds,
  type ComposableAddonRef,
} from "@/utils/mapSiblingAddonOfferIds";
/**
 * mode:
 *   - "contact" (default) — текущее поведение: ссылка привязывается к контакту,
 *     показывается блок получателя, доступна Telegram-цепочка.
 *   - "public" — публичная ссылка без получателя: блок контакта скрыт,
 *     userId не отправляется в writer, Telegram-логика не рендерится.
 *     Writer тот же — admin-create-public-link → /pay/:token.
 */
export type AdminPaymentLinkDialogMode = "contact" | "public";

interface AdminPaymentLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  userName?: string;
  userEmail?: string;
  telegramUserId?: number | null;
  mode?: AdminPaymentLinkDialogMode;
}

type PaymentType = "one_time" | "subscription";

type ResolveSource = "exact" | "primary" | "single";
type ResolveMode = "canonical" | "override";

interface ResolvedOffer {
  ok: true;
  offer: TariffOffer;
  source: ResolveSource;
  /**
   * Режим резолва:
   *  - 'canonical' — найден active pay_now offer ровно того типа, что выбрал админ.
   *  - 'override'  — exact-match нет; offer используется как источник параметров
   *                  (цена/описание/product linkage), но payment_type ссылки
   *                  остаётся равен выбору админа (controlled override).
   */
  mode: ResolveMode;
  /** true только в режиме override — UI показывает явное предупреждение. */
  isOverride: boolean;
  /** Тип найденного offer (для отображения «у тарифа есть только …»). */
  offerType: PaymentType;
}

interface ResolveBlocked {
  ok: false;
  reason: "no_active_offers";
  message: string;
}

type ResolveResult = ResolvedOffer | ResolveBlocked;

/**
 * Канонический резолвер offer для admin payment link.
 *
 * Контракт системы:
 *  - payment_type ссылки = выбор админа (source of truth).
 *  - offer = источник параметров тарифа (цена, описание, продукт).
 *
 * Режимы:
 *   A. canonical — exact: active pay_now нужного типа найден.
 *   B. override  — exact нет, но есть хотя бы один active pay_now offer любого типа.
 *                  Используем primary / single как источник параметров; payment_type
 *                  ссылки = desiredType (выбор админа).
 *   STOP — нет ни одного active pay_now offer (тариф не продаётся).
 */
function resolveCanonicalOffer(
  allOffers: TariffOffer[] | undefined,
  desiredType: PaymentType
): ResolveResult {
  const active = (allOffers || []).filter(
    (o) => o.is_active && o.offer_type === "pay_now"
  );

  if (active.length === 0) {
    return {
      ok: false,
      reason: "no_active_offers",
      message:
        "У этого тарифа нет активных кнопок оплаты. Добавьте кнопку в настройках тарифа.",
    };
  }

  const isOfferSubscription = (o: TariffOffer) =>
    !!o.meta?.recurring?.is_recurring;
  const offerType = (o: TariffOffer): PaymentType =>
    isOfferSubscription(o) ? "subscription" : "one_time";

  // A. exact match — режим canonical
  const exact = active.find((o) => offerType(o) === desiredType);
  if (exact) {
    return {
      ok: true,
      offer: exact,
      source: "exact",
      mode: "canonical",
      isOverride: false,
      offerType: desiredType,
    };
  }

  // B. override — берём primary, иначе single, иначе первый active
  const fallbackOffer =
    active.find((o) => o.is_primary) ??
    (active.length === 1 ? active[0] : active[0]);

  return {
    ok: true,
    offer: fallbackOffer,
    source: active.find((o) => o.is_primary)
      ? "primary"
      : active.length === 1
      ? "single"
      : "primary",
    mode: "override",
    isOverride: true,
    offerType: offerType(fallbackOffer),
  };
}

export function AdminPaymentLinkDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
  telegramUserId,
  mode = "contact",
}: AdminPaymentLinkDialogProps) {
  const isPublicMode = mode === "public";
  // В public-режиме Telegram-цепочка и contact-блок не должны рендериться.
  const effectiveTelegramUserId = isPublicMode ? null : telegramUserId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectPortalContainer, setSelectPortalContainer] = useState<HTMLElement | null>(null);
  const setDialogContentRef = useCallback((node: HTMLDivElement | null) => {
    setSelectPortalContainer(node);
  }, []);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [selectedTariffId, setSelectedTariffId] = useState<string>("");
  // selectedOfferId — пользовательский override; если пуст, используется resolver.offer.id
  const [selectedOfferId, setSelectedOfferId] = useState<string>("");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [description, setDescription] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("one_time");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);
  const [replaceStep, setReplaceStep] = useState<
    "idle" | "cancelling" | "creating" | "error"
  >("idle");
  const [combinedPending, setCombinedPending] = useState(false);
  // Stage L: выбранный срок рассрочки (только для installment-офферов)
  const [selectedInstallmentMonths, setSelectedInstallmentMonths] = useState<number | null>(null);
  const [selectedAddonOfferIds, setSelectedAddonOfferIds] = useState<string[]>([]);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  // Sprint «Составные продажи ЦБ» — panels для invoice (ЮЛ/ИП/ФЛ) и Ресурс развития (RR).
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);
  const [rrPanelOpen, setRrPanelOpen] = useState(false);
  const [invoicePayerType, setInvoicePayerType] = useState<"individual" | "entrepreneur" | "legal_entity">("legal_entity");
  const [invoiceLegalDetailsId, setInvoiceLegalDetailsId] = useState<string>("");
  const [invoicePending, setInvoicePending] = useState(false);
  const [rrPending, setRrPending] = useState(false);
  // Blocker fix ORD-26-02827: invoice delivery success внутри админского flow.
  const [invoiceIssueResult, setInvoiceIssueResult] = useState<
    | null
    | {
        document_id: string | null;
        invoice_number: string;
        document_number: string | null;
        document_issued_at: string | null;
        order_id: string | null;
      }
  >(null);

  // Phase 4.1 — provider routing UI state
  const [provider, setProvider] = useState<"bepaid" | "stripe">("bepaid");
  const [stripeAccountCode, setStripeAccountCode] = useState<string>("");
  // Hotfix-1 (Phase 8 plan §HOTFIX-1):
  //   Default Stripe-валюты = валюта выбранного offer (offer.currency || offer.meta.currency || 'BYN').
  //   Никакого hardcoded "EUR". Если админ вручную меняет валюту — флаг
  //   `stripeCurrencyManuallySet` блокирует авто-перезапись при смене оффера.
  const [stripeCurrency, setStripeCurrency] = useState<string>("BYN");
  const [stripeCurrencyManuallySet, setStripeCurrencyManuallySet] = useState(false);
  // Phase 5-C — provider_mode (fixed vs customer_choice) для публичной ссылки.
  // 'auto' = по настройке кнопки оплаты (multi-provider оффер → customer_choice; иначе fixed=default).
  // 'customer_choice' = override: клиент выбирает из всех технически доступных provider'ов,
  //                     независимо от offer.allowed_payment_providers. Override живёт только в payment_links.
  const [providerModeChoice, setProviderModeChoice] = useState<
    "auto" | "customer_choice" | "bepaid" | "stripe"
  >("auto");
  // Phase 5-D — super_admin может выбрать provider, даже если он не в offer.allowed_payment_providers.
  const { hasRole: isSuperAdmin } = useHasRoleV2("super_admin");

  const { data: products, isLoading: productsLoading } = useProductsV2();
  const { data: tariffs, isLoading: tariffsLoading } = useTariffs(selectedProductId);
  const { data: allOffers, isLoading: offersLoading } = useTariffOffers(
    selectedTariffId || undefined
  );

  // Phase 4.1 — список активных Stripe-подключений для селектора account_code.
  // PATCH 4.1.1 — добавлен capabilities_snapshot для disabled-стейтов валют.
  const { data: stripeAccounts } = useQuery({
    queryKey: ["acquiring-connections-stripe-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acquiring_connections")
        .select("account_code, account_name, test_mode, is_default, capabilities_snapshot")
        .eq("provider", "stripe")
        .eq("status", "active")
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // UX fix: предзагружаем default Stripe-аккаунт сразу, как только список загружен,
  // чтобы кнопка «Иностранная карта» в блоке выбора способа оплаты не была
  // disabled при первом открытии диалога из-за `stripe_account_resolved=false`.
  useEffect(() => {
    if (!stripeAccountCode && stripeAccounts?.length) {
      const def = stripeAccounts.find((a: any) => a.is_default) ?? stripeAccounts[0];
      setStripeAccountCode((def as any).account_code);
    }
  }, [stripeAccounts, stripeAccountCode]);

  // Sprint «Составные продажи ЦБ» — legal_details целевого пользователя (для invoice ЮЛ/ИП).
  // Канонический резолвер: тот же путь, что public InvoiceCheckoutDialog / useLegalDetails —
  // profiles.user_id → client_legal_details.profile_id. Флаг «по-умолчанию» — is_default
  // (единственный boolean в схеме; is_primary в client_legal_details не существует и раньше
  // ронял весь select, из-за чего резолвер молча возвращал пустой массив → «нет карточек»).
  const { data: targetLegalDetails } = useQuery({
    queryKey: ["admin-payment-link-target-legal-details", userId],
    enabled: !!userId && invoicePanelOpen,
    queryFn: async () => {
      const { data: profile } = await supabase
        .from("profiles").select("id").eq("user_id", userId!).maybeSingle();
      if (!profile) return [];
      const { data, error } = await supabase
        .from("client_legal_details")
        .select("id, client_type, leg_name, leg_org_form, ent_name, leg_unp, ent_unp, is_default")
        .eq("profile_id", profile.id)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Phase 7-UI follow-up — supported currencies выбранного Stripe-аккаунта.
  // Передаются в shared `resolveAvailableProviders` (frontend mirror SOT).
  // Если snapshot пуст — резолвер выдаёт R1 fallback (warning) и не дизейблит ничего;
  // финальная блокировка всё равно происходит на backend.
  const stripeAccountSupportedCurrencies = useMemo<string[] | null>(() => {
    if (!stripeAccountCode) return null;
    const acct = (stripeAccounts ?? []).find(
      (a: any) => a.account_code === stripeAccountCode,
    ) as any;
    const arr = acct?.capabilities_snapshot?.supported_currencies;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((c: unknown) => String(c));
  }, [stripeAccountCode, stripeAccounts]);

  const STRIPE_CURRENCY_OPTIONS = ["BYN", "EUR", "USD", "PLN"] as const;

  // Phase 7-UI follow-up — все currency/provider проверки UI идут через shared mirror.
  // Backend всё равно перепроверяет в admin-create-public-link (SOT = edge resolver).
  const resolveProviderForUi = (
    p: "bepaid" | "stripe",
    currency: string,
  ): { allowed: boolean; reason?: string; message?: string } => {
    const r = resolveAvailableProviders({
      currency,
      payment_type: paymentType,
      candidate_providers: [p],
      stripe_account_supported_currencies: stripeAccountSupportedCurrencies,
      stripe_account_resolved: Boolean(stripeAccountCode),
      bepaid_shop_resolved: true,
      is_installment: isInstallmentOffer,
    });
    if (r.availableProviders.includes(p)) return { allowed: true };
    const d = r.disabledProviders.find((x) => x.provider === p);
    return { allowed: false, reason: d?.reason_code, message: d?.message };
  };

  const isStripeCurrencyDisabled = (code: string): { disabled: boolean; message?: string } => {
    const r = resolveAvailableProviders({
      currency: code,
      payment_type: paymentType,
      candidate_providers: ["stripe"],
      stripe_account_supported_currencies: stripeAccountSupportedCurrencies,
      stripe_account_resolved: Boolean(stripeAccountCode),
      is_installment: isInstallmentOffer,
    });
    if (r.availableProviders.includes("stripe")) return { disabled: false };
    const d = r.disabledProviders.find((x) => x.provider === "stripe");
    return { disabled: true, message: d?.message };
  };

  // Phase 7-UI follow-up — auto-fallback валюты УДАЛЁН (см. план §Scope.1).
  // Пользователь сам выбирает совместимую currency × provider комбинацию;
  // backend блокирует несовместимые конфигурации controlled-ошибкой.

  // PATCH 4.1.2 — единый derived-валютный токен для UI-меток/preview.
  // Backend сам выбирает валюту корректно; здесь только отображение.
  const previewCurrency: string = provider === "stripe" ? stripeCurrency : "BYN";


  // Список всех active pay_now offers (источник для override и резолвера).
  const activeOffers = useMemo(
    () => (allOffers || []).filter((o) => o.is_active && o.offer_type === "pay_now"),
    [allOffers]
  );

  // BLOCKER FIX (Phase 6-G/7 boundary): отсутствие meta.stripe.price_id больше
  // НЕ блокирует создание Stripe-подписочной ссылки. Backend (admin-create-public-link)
  // сам вызовет admin-provision-stripe-price при необходимости и идемпотентно создаст/найдёт
  // Stripe Price. Frontend не является SOT — финальная валидация выполняется на backend.
  const visibleOffers = activeOffers;

  // Sprint «Составные продажи ЦБ» — sibling invoice / RR офферы того же тарифа.
  // Никаких хардкод UUID — источник истины tariff_offers.offer_type / meta.bank_installment.rr_runtime.
  const invoiceSiblingOffer = useMemo(
    () => (allOffers || []).find((o: any) => o.is_active && o.offer_type === "invoice") ?? null,
    [allOffers],
  );
  const rrSiblingOffer = useMemo(
    () =>
      (allOffers || []).find(
        (o: any) =>
          o.is_active &&
          o.offer_type === "bank_installment" &&
          o?.meta?.bank_installment?.rr_runtime?.enabled === true &&
          o?.meta?.bank_installment?.rr_runtime?.provider === "rr",
      ) ?? null,
    [allOffers],
  );

  // Автосброс selectedOfferId, если выбранная кнопка вышла из visibleOffers (смена провайдера/типа).
  useEffect(() => {
    if (!selectedOfferId) return;
    if (visibleOffers.some((o) => o.id === selectedOfferId)) return;
    setSelectedOfferId("");
  }, [visibleOffers, selectedOfferId]);

  // Резолвер: работает на ВСЕХ offers (без предварительной фильтрации по типу).
  const resolved = useMemo(
    () => resolveCanonicalOffer(allOffers, paymentType),
    [allOffers, paymentType]
  );


  // Effective offer: пользовательский override (если выбран и валиден) > resolver.
  // BLOCKER FIX: Stripe+subscription больше не требует meta.stripe.price_id во фронте —
  // оффер выбирается так же, как для bePaid, а технический provider mapping (Stripe Price)
  // обеспечивает backend через admin-provision-stripe-price.
  const effectiveOffer: TariffOffer | null = useMemo(() => {
    if (!resolved.ok) return null;
    if (selectedOfferId) {
      const userPick = (allOffers || []).find(
        (o) => o.id === selectedOfferId && o.is_active && o.offer_type === "pay_now"
      );
      if (userPick) return userPick;
    }
    return resolved.offer;
  }, [resolved, selectedOfferId, allOffers]);

  const { data: composableQuote, isFetching: composableQuoteLoading } = useQuery({
    queryKey: ["composable-checkout-quote", effectiveOffer?.id, selectedAddonOfferIds],
    enabled: !!effectiveOffer?.id,
    queryFn: async () => {
      const parentOfferId = effectiveOffer!.id;
      const { data, error } = await supabase.functions.invoke("composable-checkout-quote", {
        body: { parent_offer_id: parentOfferId, addon_offer_ids: selectedAddonOfferIds },
      });
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      if (!data?.success) throw new Error(data?.error || "Не удалось рассчитать комплект");
      // Тегируем ответ id-оффера, чтобы UI мог отбросить stale-квоты, пришедшие для
      // предыдущего продукта/тарифа (защита от race при быстром переключении).
      return { ...(data as any), __parentOfferId: parentOfferId };
    },
    staleTime: 0,
  });

  // Считаем quote «свежей» только если она относится к текущему effectiveOffer.
  const quoteMatchesCurrentOffer =
    !!effectiveOffer?.id && composableQuote?.__parentOfferId === effectiveOffer.id;

  const sourceAvailableAddons = useMemo<ComposableAddonRef[]>(
    () =>
      Array.isArray(composableQuote?.available_addons)
        ? composableQuote.available_addons
        : [],
    [composableQuote?.available_addons],
  );

  // Invoice и RR используют sibling-offer того же тарифа. Их offer_addons могут
  // ссылаться на другие offer_id тех же дополнительных продуктов, поэтому
  // нельзя отправлять выбранные pay_now IDs напрямую.
  const siblingOfferForQuote = rrPanelOpen
    ? rrSiblingOffer
    : invoicePanelOpen
      ? invoiceSiblingOffer
      : null;

  const {
    data: siblingCatalogQuote,
    isFetching: siblingCatalogLoading,
    error: siblingCatalogError,
  } = useQuery({
    queryKey: ["composable-checkout-sibling-catalog", siblingOfferForQuote?.id],
    enabled: !!siblingOfferForQuote?.id,
    queryFn: async () => {
      const parentOfferId = siblingOfferForQuote!.id;
      const { data, error } = await supabase.functions.invoke("composable-checkout-quote", {
        body: { parent_offer_id: parentOfferId, addon_offer_ids: [] },
      });
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      if (!data?.success) throw new Error(data?.error || "Не удалось загрузить состав сценария оплаты");
      return { ...(data as any), __parentOfferId: parentOfferId };
    },
    staleTime: 0,
  });

  const siblingAvailableAddons = useMemo<ComposableAddonRef[]>(
    () =>
      Array.isArray(siblingCatalogQuote?.available_addons)
        ? siblingCatalogQuote.available_addons
        : [],
    [siblingCatalogQuote?.available_addons],
  );
  const siblingAddonMapping = useMemo(
    () =>
      mapSiblingAddonOfferIds(
        sourceAvailableAddons,
        siblingAvailableAddons,
        selectedAddonOfferIds,
      ),
    [sourceAvailableAddons, siblingAvailableAddons, selectedAddonOfferIds],
  );

  const {
    data: siblingComposableQuote,
    isFetching: siblingQuoteLoading,
    error: siblingQuoteError,
  } = useQuery({
    queryKey: [
      "composable-checkout-sibling-quote",
      siblingOfferForQuote?.id,
      siblingAddonMapping.addonOfferIds,
    ],
    enabled:
      !!siblingOfferForQuote?.id &&
      siblingCatalogQuote?.__parentOfferId === siblingOfferForQuote.id &&
      siblingAddonMapping.missingAddonNames.length === 0,
    queryFn: async () => {
      const parentOfferId = siblingOfferForQuote!.id;
      const { data, error } = await supabase.functions.invoke("composable-checkout-quote", {
        body: {
          parent_offer_id: parentOfferId,
          addon_offer_ids: siblingAddonMapping.addonOfferIds,
        },
      });
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      if (!data?.success) throw new Error(data?.error || "Не удалось рассчитать состав сценария оплаты");
      return { ...(data as any), __parentOfferId: parentOfferId };
    },
    staleTime: 0,
  });

  const siblingQuoteMatchesCurrentOffer =
    !!siblingOfferForQuote?.id &&
    siblingComposableQuote?.__parentOfferId === siblingOfferForQuote.id;
  const siblingCompositionError =
    siblingAddonMapping.missingAddonNames.length > 0
      ? `Для этого способа оплаты не настроены: ${siblingAddonMapping.missingAddonNames.join(", ")}`
      : siblingCatalogError instanceof Error
        ? siblingCatalogError.message
        : siblingQuoteError instanceof Error
          ? siblingQuoteError.message
          : null;
  const siblingCompositionPending =
    !siblingCompositionError &&
    (siblingCatalogLoading ||
      siblingQuoteLoading ||
      (!!siblingOfferForQuote && !siblingQuoteMatchesCurrentOffer));


  useEffect(() => {
    setSelectedAddonOfferIds([]);
    setAdjustmentReason("");
  }, [effectiveOffer?.id]);

  useEffect(() => {
    if (composableQuote?.subtotal != null) {
      setCustomAmount(String(composableQuote.subtotal));
    }
  }, [composableQuote?.subtotal]);

  // Hotfix-1 — авто-default Stripe-валюты от offer.currency / offer.meta.currency / 'BYN'.
  // Не перетирает выбор админа, если он уже вручную поменял валюту.
  useEffect(() => {
    if (stripeCurrencyManuallySet) return;
    const offerCurrency =
      ((effectiveOffer as any)?.currency as string | undefined) ||
      ((effectiveOffer as any)?.meta?.currency as string | undefined) ||
      "BYN";
    const upper = offerCurrency.toUpperCase();
    if (upper !== stripeCurrency) setStripeCurrency(upper);
    // Сброс manual-flag при смене оффера через selectedOfferId не делаем —
    // явный выбор админа сохраняется в рамках одной сессии модалки.
  }, [effectiveOffer, stripeCurrencyManuallySet, stripeCurrency]);

  // Phase 5-C — allowed providers с уровня оффера (SOT для customer_choice).
  const offerAllowedProviders = useMemo<("bepaid" | "stripe")[]>(() => {
    const list = (effectiveOffer as any)?.meta?.acquiring?.allowed_payment_providers;
    if (!Array.isArray(list)) return ["bepaid"];
    return list.filter((p: any) => p === "bepaid" || p === "stripe");
  }, [effectiveOffer]);
  const offerSupportsCustomerChoice = offerAllowedProviders.length >= 2;

  // Эффективный provider/provider_mode для отправки в admin-create-public-link.
  // 'auto' + multi → customer_choice. 'auto' + single → fixed=default.
  // 'customer_choice' → customer_choice override (allowed_payment_providers вычисляется отдельно).
  // 'bepaid' / 'stripe' → fixed=пользовательский выбор.
  const effectiveProviderMode: "fixed" | "customer_choice" = useMemo(() => {
    if (providerModeChoice === "auto") {
      return offerSupportsCustomerChoice ? "customer_choice" : "fixed";
    }
    if (providerModeChoice === "customer_choice") return "customer_choice";
    return "fixed";
  }, [providerModeChoice, offerSupportsCustomerChoice]);
  const effectiveProvider: "bepaid" | "stripe" = useMemo(() => {
    if (providerModeChoice === "auto") {
      // single-provider offer → используем единственный allowed; multi → bepaid (default).
      return offerAllowedProviders.length === 1 ? offerAllowedProviders[0] : "bepaid";
    }
    if (providerModeChoice === "customer_choice") {
      // payment_links.provider — backward-compat колонка. SOT для customer_choice = meta.allowed_payment_providers.
      return "bepaid";
    }
    return providerModeChoice;
  }, [providerModeChoice, offerAllowedProviders]);

  // Синхронизируем legacy state `provider` для существующих Stripe-валидаций.
  useEffect(() => {
    if (provider !== effectiveProvider) setProvider(effectiveProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProvider]);



  // КОНТРАКТ: payment_type ссылки = ВСЕГДА выбор админа (ToggleGroup).
  // Offer используется только как источник параметров (цена/описание/продукт).
  // Никаких silent derive из offer.meta.recurring — это и было корнем бага
  // «выбираю one_time → создаётся subscription».
  const effectivePaymentType: PaymentType = paymentType;

  // Тип выбранного offer'а (для отображения badge / warning).
  const effectiveOfferType: PaymentType = useMemo(() => {
    if (!effectiveOffer) return paymentType;
    return effectiveOffer.meta?.recurring?.is_recurring
      ? "subscription"
      : "one_time";
  }, [effectiveOffer, paymentType]);

  // Override = выбор админа не совпадает с типом offer'а, но ссылка всё равно
  // создаётся как payment_type выбранный админом (controlled override).
  const isOverrideMode =
    !!effectiveOffer && effectiveOfferType !== effectivePaymentType;



  // ── Stage L: installment offer detection ──
  // offerKind: 'installment' | 'subscription' | 'one_time'.
  // Источник: payment_method='internal_installment' → installment.
  const isInstallmentOffer =
    !!effectiveOffer && (effectiveOffer as any).payment_method === "internal_installment";
  const installmentMaxMonths = useMemo(() => {
    if (!isInstallmentOffer || !effectiveOffer) return null;
    // Priority: precise installment_count > legacy meta.installment.max_months.
    const legacy = Number((effectiveOffer as any).installment_count ?? 0);
    if (legacy >= 2) return Math.min(12, legacy);
    const metaMax = Number((effectiveOffer as any).meta?.installment?.max_months ?? 0);
    if (metaMax >= 2) return Math.min(12, metaMax);
    return null;
  }, [isInstallmentOffer, effectiveOffer]);
  // per_payment для installment считается inline в JSX (там, где amount уже доступен).

  // ── «Клиент выбирает» — override allowed_payment_providers ──
  // Собирает все технически доступные provider'ы независимо от offer.allowed_payment_providers.
  // STOP-guards:
  //   • bepaid: считаем доступным (нет лёгкого client-side disable-signal; backend валидирует);
  //   • stripe: нужен хотя бы один active acquiring_connection, не installment, валюта в whitelist.
  const stripeAvailableForCustomerChoice = useMemo(() => {
    if (!stripeAccounts || stripeAccounts.length === 0) return false;
    // Phase 7-UI follow-up — используем shared mirror резолвер.
    // Берём дефолтный/первый Stripe-аккаунт (как и раньше),
    // currency = текущий выбор админа (stripeCurrency).
    const acct = (stripeAccounts.find((a: any) => a.is_default) ?? stripeAccounts[0]) as any;
    const cap = acct?.capabilities_snapshot?.supported_currencies;
    const supported = Array.isArray(cap) && cap.length > 0
      ? cap.map((c: unknown) => String(c))
      : null;
    const r = resolveAvailableProviders({
      currency: stripeCurrency,
      payment_type: paymentType,
      candidate_providers: ["stripe"],
      stripe_account_supported_currencies: supported,
      stripe_account_resolved: true,
      is_installment: isInstallmentOffer,
    });
    return r.availableProviders.includes("stripe");
  }, [stripeAccounts, isInstallmentOffer, stripeCurrency, paymentType]);

  const customerChoiceAllowed = useMemo<("bepaid" | "stripe")[]>(() => {
    const list: ("bepaid" | "stripe")[] = ["bepaid"];
    if (stripeAvailableForCustomerChoice) list.push("stripe");
    return list;
  }, [stripeAvailableForCustomerChoice]);

  // Phase 8 follow-up FIX — auto vs explicit recurring policy.
  // Lock only in auto-mode ("По настройке кнопки"): тогда система следует SOT оффера и
  // recurring offer + Stripe гарантированно даёт subscription. В explicit-режимах
  // (Белорусская карта / Иностранная карта / Клиент выбирает) админ — источник истины и
  // имеет право создать разовую админскую оплату даже по recurring offer.
  const isStripePathActive =
    provider === "stripe" ||
    (providerModeChoice === "customer_choice" && stripeAvailableForCustomerChoice);
  const isAutoProviderMode = providerModeChoice === "auto";
  const isExplicitProviderMode = !isAutoProviderMode;
  const recurringOfferOnStripePath =
    !!effectiveOffer &&
    effectiveOfferType === "subscription" &&
    isStripePathActive &&
    !isInstallmentOffer;
  const lockPaymentTypeToSubscription =
    recurringOfferOnStripePath && isAutoProviderMode;
  // Warning без блокировки: explicit + recurring + one_time на Stripe.
  const warnExplicitOneTimeOnRecurringStripe =
    recurringOfferOnStripePath &&
    isExplicitProviderMode &&
    paymentType === "one_time";
  // Hint: explicit + subscription на Stripe.
  const hintExplicitSubscriptionStripe =
    isStripePathActive &&
    isExplicitProviderMode &&
    paymentType === "subscription" &&
    !isInstallmentOffer;

  useEffect(() => {
    if (lockPaymentTypeToSubscription && paymentType !== "subscription") {
      setPaymentType("subscription");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockPaymentTypeToSubscription]);


  // Авто-переключение с customer_choice, если ни один provider не доступен (теоретически невозможно,
  // т.к. bepaid считаем всегда доступным; на случай будущих изменений).
  useEffect(() => {
    if (providerModeChoice !== "customer_choice") return;
    if (customerChoiceAllowed.length === 0) setProviderModeChoice("auto");
  }, [providerModeChoice, customerChoiceAllowed]);


  // ── Унифицированный билдер Telegram-сообщения ──
  // Корректно различает три случая: рассрочка / подписка с автосписанием / разовая оплата.
  // Источники истины: isInstallmentOffer (payment_method='internal_installment'),
  // effectivePaymentType ('subscription' | 'one_time'), selectedInstallmentMonths.
  const buildTelegramMessage = (productName: string, tariffName: string) => {
    // ВАЖНО: используем HTML-разметку, а НЕ Markdown.
    // Причина: legacy Markdown в Telegram нестабильно распознаёт жирный
    // текст рядом с эмодзи и оставляет звёздочки как литералы. HTML
    // (`<b>...</b>`) такой проблемы не имеет и поддерживается всеми
    // клиентами Telegram. Edge `telegram-send-notification`
    // автоматически переключается на parse_mode=HTML при наличии тегов.
    const escapeHtml = (t: string) =>
      (t || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const isInstallmentMsg =
      isInstallmentOffer && (selectedInstallmentMonths ?? 0) >= 2;
    const isSubscriptionMsg =
      !isInstallmentMsg && effectivePaymentType === "subscription";

    const headerKind = isInstallmentMsg
      ? "в рассрочку"
      : isSubscriptionMsg
        ? "подписки"
        : "доступа";

    const typeLabel = isInstallmentMsg
      ? `Рассрочка · ${selectedInstallmentMonths} платеж${
          selectedInstallmentMonths === 1
            ? ""
            : (selectedInstallmentMonths ?? 0) < 5
              ? "а"
              : "ей"
        }`
      : isSubscriptionMsg
        ? "Подписка с автосписанием"
        : "Разовая оплата";

    const N = selectedInstallmentMonths || 1;
    const perPayment = isInstallmentMsg ? Math.ceil(amount / N) : amount;
    const totalAmount = isInstallmentMsg ? perPayment * N : amount;
    const amountLine = isInstallmentMsg
      ? `💰 Стоимость: ${N} × ${perPayment} ${previewCurrency} (итого ${totalAmount} ${previewCurrency})`
      : `💰 Стоимость: ${amount} ${previewCurrency}`;

    return `💳 <b>Оплата ${headerKind}</b>

📦 Продукт: ${escapeHtml(productName)}
📋 Тариф: ${escapeHtml(tariffName)}
${amountLine}
📅 Тип: ${typeLabel}`;
  };





  // Tariff price fallback (если у тарифа нет ни одного offer)
  const { data: tariffPrices } = useQuery({
    queryKey: ["tariff_prices_for_link", selectedTariffId],
    queryFn: async () => {
      if (!selectedTariffId) return null;
      const { data, error } = await supabase
        .from("tariff_prices")
        .select("*")
        .eq("tariff_id", selectedTariffId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!selectedTariffId,
  });

  // === Replace subscription mutation (PATCH E) ===
  const replaceSubscriptionMutation = useMutation({
    mutationFn: async (conflictInfo: any) => {
      const subV2Id = conflictInfo.subscription_v2_id;

      setReplaceStep("cancelling");
      const { data: cancelData, error: cancelError } =
        await supabase.functions.invoke("bepaid-cancel-subscriptions", {
          body: { subscription_v2_id: subV2Id, source: "admin_replace" },
        });
      if (cancelError)
        throw new Error("Ошибка отмены у провайдера: " + cancelError.message);
      if (cancelData?.failed?.length > 0) {
        throw new Error(
          "Провайдер не смог отменить подписку: " +
            (cancelData.failed[0]?.error || "неизвестная ошибка")
        );
      }

      const { error: updateErr } = await supabase
        .from("subscriptions_v2")
        .update({ status: "superseded", auto_renew: false })
        .eq("id", subV2Id);
      if (updateErr) {
        console.error("[PATCH E] Failed to mark old sub as superseded:", updateErr);
      }

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { error: auditErr } = await supabase.from("audit_logs").insert({
        actor_type: "user",
        actor_user_id: currentUser?.id || null,
        target_user_id: userId,
        action: "subscription.replace_started",
        meta: {
          old_subscription_v2_id: subV2Id,
          product_id: conflictInfo.product_id,
          tariff_id: conflictInfo.tariff_id,
          old_bepaid_subscription_id: conflictInfo.bepaid_subscription_id,
          cancel_result: cancelData,
          actor_type: "admin",
        },
      });
      if (auditErr) console.error("[PATCH E] replace_started audit insert failed:", auditErr);

      setReplaceStep("creating");
      const { data, error } = await supabase.functions.invoke(
        "admin-create-payment-link",
        {
          body: {
            user_id: userId,
            product_id: selectedProductId,
            tariff_id: selectedTariffId,
            offer_id: effectiveOffer?.id,
            amount: Math.round(amount * 100),
            adjustment_amount: composableAdjustment,
            adjustment_reason: composableAdjustment === 0 ? null : adjustmentReason.trim(),
            payment_type: effectivePaymentType,
            description:
              description || `${selectedProduct?.name} — ${selectedTariff?.name}`,
            replacement_of_subscription_v2_id: subV2Id,
            requested_payment_type: paymentType,
            resolved_mode: isOverrideMode ? "override" : "canonical",
            cta_source: "admin_manual",
            cta_contract_version: 1,
          },
        }
      );
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Ошибка создания ссылки");
      return data;
    },
    onSuccess: (data) => {
      setGeneratedUrl(data.redirect_url);
      setConflictData(null);
      setReplaceStep("idle");
      toast.success("Старая подписка отменена, новая ссылка создана");
      queryClient.invalidateQueries({
        queryKey: ["contact-provider-subscriptions", userId],
      });
    },
    onError: (error: Error) => {
      setReplaceStep("error");
      toast.error("Ошибка замены подписки: " + error.message);
    },
  });

  // Явный сброс всех состояний, которые зависят от выбранного продукта.
  // НЕ трогает selectedProductId — вызывающая сторона сама выставляет новое значение.
  const resetProductDependentState = useCallback(() => {
    setSelectedTariffId("");
    setSelectedOfferId("");
    setCustomAmount("");
    setGeneratedUrl(null);
    setConflictData(null);
    setReplaceStep("idle");
    setShowCancelConfirm(false);
    setSelectedAddonOfferIds([]);
    setAdjustmentReason("");
    setInvoicePanelOpen(false);
    setRrPanelOpen(false);
    setInvoiceLegalDetailsId("");
    setInvoiceIssueResult(null);
    setSelectedInstallmentMonths(null);
    queryClient.removeQueries({ queryKey: ["composable-checkout-quote"] });
  }, [queryClient]);

  // Сброс состояний, зависящих от тарифа (не трогает product/tariff id).
  const resetTariffDependentState = useCallback(() => {
    setSelectedOfferId("");
    setCustomAmount("");
    setGeneratedUrl(null);
    setConflictData(null);
    setReplaceStep("idle");
    setShowCancelConfirm(false);
    setSelectedAddonOfferIds([]);
    setAdjustmentReason("");
    setInvoicePanelOpen(false);
    setRrPanelOpen(false);
    setInvoiceIssueResult(null);
    queryClient.removeQueries({ queryKey: ["composable-checkout-quote"] });
  }, [queryClient]);

  // Явные хендлеры Select: атомарно принимают новый id и очищают только dependent state.
  const handleProductChange = useCallback((newProductId: string) => {
    if (newProductId === selectedProductId) return;
    setSelectedProductId(newProductId);
    resetProductDependentState();
  }, [selectedProductId, resetProductDependentState]);

  const handleTariffChange = useCallback((newTariffId: string) => {
    if (newTariffId === selectedTariffId) return;
    resetTariffDependentState();
    setSelectedTariffId(newTariffId);
  }, [selectedTariffId, resetTariffDependentState]);

  // Полный reset выполняется ТОЛЬКО на переходе диалога false → true.
  // Никаких зависимостей от productId/tariffId/queryClient — иначе они будут
  // затирать только что выбранный продукт при перерендерах.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      setSelectedProductId("");
      setSelectedTariffId("");
      setSelectedOfferId("");
      setCustomAmount("");
      setDescription("");
      setPaymentType("one_time");
      setGeneratedUrl(null);
      setShowCancelConfirm(false);
      setConflictData(null);
      setReplaceStep("idle");
      setSelectedInstallmentMonths(null);
      setSelectedAddonOfferIds([]);
      setAdjustmentReason("");
      setInvoicePanelOpen(false);
      setRrPanelOpen(false);
      setInvoicePayerType("legal_entity");
      setInvoiceLegalDetailsId("");
      setInvoiceIssueResult(null);
      setInvoicePending(false);
      setRrPending(false);
      queryClient.removeQueries({ queryKey: ["composable-checkout-quote"] });
    }
  }, [open, queryClient]);




  // PATCH PAYMENT-CONFLICT v3: конфликт product-level (без tariff_id) и только для подписки.
  const isCurrentConflict = useMemo(() => {
    if (!conflictData) return false;
    if (effectivePaymentType !== "subscription") return false;
    return conflictData.product_id === selectedProductId;
  }, [conflictData, effectivePaymentType, selectedProductId]);

  const selectedProduct = products?.find((p) => p.id === selectedProductId);
  const selectedTariff = tariffs?.find((t) => t.id === selectedTariffId);
  const amount = parseFloat(customAmount) || 0;
  const composableSubtotal = Number(composableQuote?.subtotal ?? 0);
  const composableCurrency = composableQuote?.currency ?? previewCurrency;
  const composableItems = Array.isArray(composableQuote?.items) ? composableQuote.items : [];
  const composableAvailableAddons = Array.isArray(composableQuote?.available_addons)
    ? composableQuote.available_addons
    : [];
  const composableAdjustment = composableQuote
    ? Math.round((amount - composableSubtotal) * 100) / 100
    : 0;
  const siblingComposableSubtotal = Number(siblingComposableQuote?.subtotal ?? 0);
  const siblingComposableCurrency = siblingComposableQuote?.currency ?? composableCurrency;
  const siblingComposableAdjustment = siblingQuoteMatchesCurrentOffer
    ? Math.round((amount - siblingComposableSubtotal) * 100) / 100
    : 0;
  const displayComposableQuote =
    (invoicePanelOpen || rrPanelOpen) && siblingQuoteMatchesCurrentOffer
      ? siblingComposableQuote
      : composableQuote;
  const displayComposableItems = Array.isArray(displayComposableQuote?.items)
    ? displayComposableQuote.items
    : [];
  const displayComposableSubtotal = Number(displayComposableQuote?.subtotal ?? 0);
  const displayComposableCurrency = displayComposableQuote?.currency ?? composableCurrency;
  const displayComposableAdjustment =
    (invoicePanelOpen || rrPanelOpen) && siblingQuoteMatchesCurrentOffer
      ? siblingComposableAdjustment
      : composableAdjustment;
  const composableSnapshot = composableQuote ? {
    version: 1,
    currency: composableCurrency,
    items: composableItems,
    subtotal: composableSubtotal,
    adjustment_amount: composableAdjustment,
    adjustment_reason: composableAdjustment === 0 ? null : adjustmentReason.trim(),
    total: amount,
    selected_addon_offer_ids: selectedAddonOfferIds,
  } : null;

  // CTA #1: «Создать ссылку и открыть оплату» → admin-create-payment-link
  //   (создаёт orders_v2 + bePaid checkout, возвращает redirect_url для немедленной оплаты)
  const createLinkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductId || !selectedTariffId) {
        throw new Error("Выберите продукт и тариф");
      }
      if (!effectiveOffer) {
        let errMsg = "Не выбрана кнопка оплаты";
        if (!resolved.ok) {
          errMsg = (resolved as ResolveBlocked).message;
        }
        throw new Error(errMsg);
      }
      if (amount <= 0) {
        throw new Error("Введите корректную сумму");
      }
      if (composableAdjustment !== 0 && !adjustmentReason.trim()) {
        throw new Error("Укажите причину скидки или наценки");
      }
      if (selectedAddonOfferIds.length > 0) {
        throw new Error("Для комплекта используйте кнопку «Создать ссылку»: состав заказа фиксируется в платёжной ссылке.");
      }
      // Stage L: installment-офферы не поддерживаются writer'ом admin-create-payment-link.
      // Используйте «Создать ссылку» (admin-create-public-link) — там реализован полный installment-flow.
      if (isInstallmentOffer) {
        throw new Error("Для рассрочки используйте кнопку «Создать ссылку» (публичную). Прямая оплата через карточку контакта не поддерживает рассрочку.");
      }

      const { data, error } = await supabase.functions.invoke(
        "admin-create-payment-link",
        {
          body: {
            user_id: userId,
            product_id: selectedProductId,
            tariff_id: selectedTariffId,
            // КОНТРАКТ: payment_type = выбор админа (source of truth).
            // offer_id передаётся как источник параметров; writer не блокирует
            // по recurring-flag offer'а.
            offer_id: effectiveOffer.id,
            amount: Math.round(amount * 100),
            adjustment_amount: composableAdjustment,
            adjustment_reason: composableAdjustment === 0 ? null : adjustmentReason.trim(),
            payment_type: effectivePaymentType,
            description:
              description || `${selectedProduct?.name} — ${selectedTariff?.name}`,
            // Audit: трассировка режима резолва на стороне writer'а.
            requested_payment_type: paymentType,
            resolved_mode: isOverrideMode ? "override" : "canonical",
            cta_source: "admin_manual",
            cta_contract_version: 1,
          },
        }
      );

      if (error) throw error;
      if (
        !data.success
        && (
          data.error === "existing_subscription_conflict"
          || data.error === "already_has_active_subscription"
        )
        && data.conflict
      ) {
        // PATCH PAYMENT-CONFLICT v3: принимаем конфликт только если это same-product для текущего выбора.
        if (data.conflict.product_id === selectedProductId) {
          setConflictData(data.conflict);
        } else {
          console.warn("[AdminPaymentLinkDialog] received conflict for different product — ignoring", data.conflict);
        }
        return null;
      }
      if (!data.success) throw new Error(data.error || "Ошибка создания ссылки");
      return data;
    },
    onSuccess: (data) => {
      if (data) {
        setGeneratedUrl(data.redirect_url);
        queryClient.invalidateQueries({ queryKey: ["payment-links-enriched"] });
        toast.success("Ссылка на оплату создана");
      }
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // CTA #2: «Создать публичную ссылку» → admin-create-public-link
  //   (только пишет row в payment_links, возвращает /pay/:token URL).
  //   НЕ создаёт orders_v2 и НЕ дёргает bePaid. Заказ материализуется позже через
  //   public-checkout, когда клиент откроет /pay/:token. Тот же canonical downstream-path.
  const createPublicLinkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductId || !selectedTariffId) {
        throw new Error("Выберите продукт и тариф");
      }
      if (!effectiveOffer) {
        let errMsg = "Не выбрана кнопка оплаты";
        if (!resolved.ok) {
          errMsg = (resolved as ResolveBlocked).message;
        }
        throw new Error(errMsg);
      }
      if (amount <= 0) {
        throw new Error("Введите корректную сумму");
      }
      if (composableAdjustment !== 0 && !adjustmentReason.trim()) {
        throw new Error("Укажите причину скидки или наценки");
      }

      const { data, error } = await supabase.functions.invoke(
        "admin-create-public-link",
        {
          body: {
            // В public mode user_id опускаем — ссылка для любого плательщика.
            ...(isPublicMode ? {} : { user_id: userId }),
            product_id: selectedProductId,
            tariff_id: selectedTariffId,
            offer_id: effectiveOffer.id,
            amount: Math.round(amount * 100),
            payment_type: effectivePaymentType,
            description:
              description || `${selectedProduct?.name} — ${selectedTariff?.name}`,
            requested_payment_type: paymentType,
            resolved_mode: isOverrideMode ? "override" : "canonical",
            cta_source: "admin_manual",
            cta_contract_version: 1,
            composable_quote: composableSnapshot,
            // Stage L: installment payload (writer ignore-ит, если поля null/false).
            ...(isInstallmentOffer && selectedInstallmentMonths
              ? {
                  installment_offer: true,
                  selected_installment_months: selectedInstallmentMonths,
                }
              : {}),
            // Phase 4.1 — provider routing
            provider: effectiveProvider,
            provider_mode: effectiveProviderMode,
            // Phase 5-D — explicit admin override marker (для audit на сервере)
            provider_choice_source: providerModeChoice === "auto" ? "auto" : "explicit",
            ...(effectiveProvider === "stripe" && effectiveProviderMode === "fixed"
              ? { account_code: stripeAccountCode, currency: stripeCurrency }
              : {}),
            // «Клиент выбирает» — override allowed_payment_providers поверх offer.meta.
            // Не передаём `currency`: link.currency остаётся в bepaid-домене (BYN);
            // Stripe-валюта для price provisioning идёт отдельным полем `stripe_currency`.
            ...(providerModeChoice === "customer_choice"
              ? {
                  allowed_payment_providers: customerChoiceAllowed,
                  ...(customerChoiceAllowed.includes("stripe")
                    ? {
                        account_code: stripeAccountCode || undefined,
                        stripe_currency: stripeCurrency,
                      }
                    : {}),
                }
              : {}),
          },
        }
      );
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Ошибка создания публичной ссылки");
      return data as { success: true; payment_link_id: string; url_token: string; public_url: string };
    },
    onSuccess: (data) => {
      setGeneratedUrl(data.public_url);
      queryClient.invalidateQueries({ queryKey: ["payment-links-enriched"] });
      toast.success("Публичная ссылка создана");
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Sprint «Составные продажи ЦБ» — invoice writer (admin-invoice-checkout-issue).
  // Selected addons + composite total идут в один order_group.
  const handleIssueInvoice = async () => {
    if (!userId) { toast.error("Только для карточки контакта"); return; }
    if (!invoiceSiblingOffer) { toast.error("У тарифа нет invoice-оффера"); return; }
    if (!selectedProductId) { toast.error("Выберите продукт"); return; }
    if ((invoicePayerType === "legal_entity" || invoicePayerType === "entrepreneur") && !invoiceLegalDetailsId) {
      toast.error("Выберите реквизиты плательщика");
      return;
    }
    if (amount <= 0) {
      toast.error("Введите корректную сумму");
      return;
    }
    if (siblingCompositionPending) {
      toast.error("Подождите, состав счёта ещё рассчитывается");
      return;
    }
    if (siblingCompositionError || !siblingQuoteMatchesCurrentOffer) {
      toast.error(siblingCompositionError || "Не удалось сопоставить состав счёта");
      return;
    }
    if (siblingComposableAdjustment !== 0 && !adjustmentReason.trim()) {
      toast.error("Укажите причину скидки или наценки");
      return;
    }
    setInvoicePending(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-invoice-checkout-issue", {
        body: {
          target_user_id: userId,
          product_id: selectedProductId,
          offer_id: invoiceSiblingOffer.id,
          addon_offer_ids: siblingAddonMapping.addonOfferIds,
          payer_type: invoicePayerType,
          legal_details_id: invoicePayerType === "individual" ? null : invoiceLegalDetailsId,
          // Сервер вычисляет исходную цену только из offer'ов, а эта разница —
          // контролируемая администратором корректировка итоговой суммы.
          adjustment_amount: siblingComposableAdjustment,
          adjustment_reason: adjustmentReason.trim() || null,
        },
      });
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      if ((data as any)?.error) throw new Error((data as any).error);
      const payload = data as any;
      // Не заявляем «отправлено» — реальные статусы покажет InvoiceDeliverySuccess.
      toast.success(`Счёт ${payload.invoice_number ?? "выписан"}. PDF готовится…`);
      queryClient.invalidateQueries({ queryKey: ["payment-links-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["contact-orders"] });
      setInvoicePanelOpen(false);
      setInvoiceIssueResult({
        document_id: payload.document_id ?? null,
        invoice_number: payload.invoice_number ?? "—",
        document_number: payload.document_number ?? null,
        document_issued_at: payload.document_issued_at ?? null,
        order_id: payload.order_id ?? null,
      });

    } catch (e: any) {
      toast.error("Ошибка счёта: " + (e?.message ?? "unknown"));
    } finally {
      setInvoicePending(false);
    }
  };

  // Sprint «Составные продажи ЦБ» — Resource Development админ-flow.
  // Контакт и права проверяются сервером: UI передаёт только target_user_id.
  const handleInitiateRr = async () => {
    if (!userId) { toast.error("Только для карточки контакта"); return; }
    if (!rrSiblingOffer) { toast.error("У тарифа нет RR-оффера"); return; }
    if (!selectedProductId) { toast.error("Выберите продукт"); return; }
    if (amount <= 0) { toast.error("Введите корректную сумму"); return; }
    if (siblingCompositionPending) {
      toast.error("Подождите, состав RR ещё рассчитывается");
      return;
    }
    if (siblingCompositionError || !siblingQuoteMatchesCurrentOffer) {
      toast.error(siblingCompositionError || "Не удалось сопоставить состав RR");
      return;
    }
    if (siblingComposableAdjustment !== 0 && !adjustmentReason.trim()) {
      toast.error("Укажите причину скидки или наценки");
      return;
    }
    setRrPending(true);
    try {
      const { data, error } = await supabase.functions.invoke("public-rr-installment-initiate", {
        body: {
          tariff_offer_id: rrSiblingOffer.id,
          addon_offer_ids: siblingAddonMapping.addonOfferIds,
          target_user_id: userId,
          adjustment_amount: siblingComposableAdjustment,
          adjustment_reason: siblingComposableAdjustment === 0 ? null : adjustmentReason.trim(),
        },
      });
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      const redirect = (data as any)?.payment_url ?? (data as any)?.redirect_url ?? (data as any)?.url ?? null;
      if (!redirect) throw new Error((data as any)?.error || "RR не вернул ссылку на оплату");
      setGeneratedUrl(redirect);
      queryClient.invalidateQueries({ queryKey: ["contact-orders"] });
      toast.success("Ссылка RR сформирована");
      setRrPanelOpen(false);
    } catch (e: any) {
      toast.error("Ошибка RR: " + (e?.message ?? "unknown"));
    } finally {
      setRrPending(false);
    }
  };



  const sendToTelegramMutation = useMutation({
    mutationFn: async () => {
      if (!generatedUrl || !selectedProduct || !selectedTariff) {
        throw new Error("Нет данных для отправки");
      }
      const telegramMessage = buildTelegramMessage(
        selectedProduct.name,
        selectedTariff.name,
      );

      const { data, error } = await supabase.functions.invoke(
        "telegram-send-notification",
        {
          body: {
            user_id: userId,
            message_type: "custom",
            custom_message: telegramMessage,
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 Ссылка на оплату", url: generatedUrl }],
              ],
            },
          },
        }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Ошибка отправки");
      return data;
    },
    onSuccess: () => {
      toast.success("Ссылка отправлена клиенту в Telegram");
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLinkMutation.mutate();
  };

  // Объединённый flow: создать публичную ссылку → сразу отправить в Telegram.
  // Используется когда у контакта привязан Telegram. Если отправка падает —
  // ссылка ВСЁ РАВНО создана и видна пользователю (ничего не теряется).
  const handleCreateAndSendTelegram = async () => {
    if (!selectedProductId || !selectedTariffId || !effectiveOffer || amount <= 0) return;
    if (composableAdjustment !== 0 && !adjustmentReason.trim()) {
      toast.error("Укажите причину скидки или наценки");
      return;
    }
    setCombinedPending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-create-public-link",
        {
          body: {
            user_id: userId,
            product_id: selectedProductId,
            tariff_id: selectedTariffId,
            offer_id: effectiveOffer.id,
            amount: Math.round(amount * 100),
            payment_type: effectivePaymentType,
            description:
              description || `${selectedProduct?.name} — ${selectedTariff?.name}`,
            requested_payment_type: paymentType,
            resolved_mode: isOverrideMode ? "override" : "canonical",
            cta_source: "telegram_combined",
            cta_contract_version: 1,
            composable_quote: composableSnapshot,
            ...(isInstallmentOffer && selectedInstallmentMonths
              ? {
                  installment_offer: true,
                  selected_installment_months: selectedInstallmentMonths,
                }
              : {}),
            // Phase 4.1 — provider routing (telegram_combined path)
            provider: effectiveProvider,
            provider_mode: effectiveProviderMode,
            // Phase 5-D — explicit admin override marker
            provider_choice_source: providerModeChoice === "auto" ? "auto" : "explicit",
            ...(effectiveProvider === "stripe" && effectiveProviderMode === "fixed"
              ? { account_code: stripeAccountCode, currency: stripeCurrency }
              : {}),
            // «Клиент выбирает» — override allowed_payment_providers поверх offer.meta.
            // Не передаём `currency` (link.currency остаётся BYN); Stripe-валюта — отдельным полем.
            ...(providerModeChoice === "customer_choice"
              ? {
                  allowed_payment_providers: customerChoiceAllowed,
                  ...(customerChoiceAllowed.includes("stripe")
                    ? {
                        account_code: stripeAccountCode || undefined,
                        stripe_currency: stripeCurrency,
                      }
                    : {}),
                }
              : {}),
          },
        }
      );
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Ошибка создания ссылки");

      const publicUrl = data.public_url as string;
      setGeneratedUrl(publicUrl);
      // Инвалидируем список ссылок, чтобы новая сразу появилась во вкладке «Ссылки»
      queryClient.invalidateQueries({ queryKey: ["payment-links-enriched"] });

      // Пробуем отправить в Telegram (тот же существующий путь)
      try {
        const telegramMessage = buildTelegramMessage(
          selectedProduct?.name ?? "—",
          selectedTariff?.name ?? "—",
        );
        const { data: tgData, error: tgError } = await supabase.functions.invoke(
          "telegram-send-notification",
          {
            body: {
              user_id: userId,
              message_type: "custom",
              custom_message: telegramMessage,
              reply_markup: {
                inline_keyboard: [[{ text: "💳 Ссылка на оплату", url: publicUrl }]],
              },
            },
          }
        );
        if (tgError) throw tgError;
        if (!tgData?.success) throw new Error(tgData?.error || "Ошибка отправки");
        toast.success("Ссылка создана и отправлена клиенту в Telegram");
      } catch (tgErr) {
        toast.warning(
          "Ссылка создана, но отправка в Telegram не удалась: " +
            ((tgErr as Error).message || "неизвестная ошибка")
        );
      }
    } catch (err) {
      toast.error("Ошибка: " + (err as Error).message);
    } finally {
      setCombinedPending(false);
    }
  };

  const handleReplaceSubscription = () => {
    if (conflictData) setShowCancelConfirm(true);
  };

  const confirmReplace = () => {
    setShowCancelConfirm(false);
    if (conflictData) replaceSubscriptionMutation.mutate(conflictData);
  };

  const paymentLinkProducts = useMemo(() => {
    const searchTerms = productSearch
      .trim()
      .toLocaleLowerCase("ru")
      .split(/\s+/)
      .filter(Boolean);

    return [...(products ?? [])]
      .filter((product) => {
        if (searchTerms.length === 0) return true;
        const normalizedName = product.name.toLocaleLowerCase("ru");
        return searchTerms.every((term) => normalizedName.includes(term));
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name, "ru", {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [products, productSearch]);

  // Индивидуальная ссылка: N обязателен, диапазон 2..12 (не ограничивается настройкой кнопки).
  const installmentInvalid =
    isInstallmentOffer &&
    (!selectedInstallmentMonths ||
      selectedInstallmentMonths < 2 ||
      selectedInstallmentMonths > 12);

  // Phase 4.1 — Stripe-specific guards (UI level, backend validates повторно).
  const stripeInstallmentBlocked = provider === "stripe" && isInstallmentOffer;
  const stripeAccountMissing = provider === "stripe" && !stripeAccountCode;
  // Phase 6-G: stripeSubscriptionPriceMissing убран — Stripe price автопровижнится по
  // настройкам кнопки. Submit больше не блокируется отсутствием price_id; backend
  // вернёт понятную ошибку, если provisioning не сработает.
  // Phase 7-UI follow-up — currency-check через shared mirror резолвер.
  const stripeCurrencyCheck = isStripeCurrencyDisabled(stripeCurrency);
  const stripeCurrencyUnsupported = provider === "stripe" && stripeCurrencyCheck.disabled;
  const stripeCurrencyUnsupportedMessage = stripeCurrencyCheck.message;
  const stripeBlocked =
    stripeInstallmentBlocked ||
    stripeAccountMissing ||
    stripeCurrencyUnsupported;

  const isCreateDisabled =
    createLinkMutation.isPending ||
    createPublicLinkMutation.isPending ||
    !selectedProductId ||
    !selectedTariffId ||
    !effectiveOffer ||
    amount <= 0 ||
    isCurrentConflict ||
    installmentInvalid ||
    stripeBlocked;


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent ref={setDialogContentRef} className="w-[min(92vw,820px)] sm:max-w-[820px] max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Link2 className="h-5 w-5 shrink-0" />
              <span className="truncate">
                {isPublicMode ? "Создать публичную ссылку" : "Ссылка на оплату"}
              </span>
            </DialogTitle>
            <DialogDescription className="text-sm">
              {isPublicMode
                ? "Ссылка не привязана к пользователю и может быть оплачена любым человеком."
                : "Создайте ссылку для самостоятельной оплаты клиентом"}
            </DialogDescription>
          </DialogHeader>

          {generatedUrl ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                  <p className="font-medium">Ссылка создана</p>
                </div>
                <p className="text-sm text-muted-foreground mb-2 break-words">
                  {selectedProduct?.name} — {selectedTariff?.name} · {amount} {previewCurrency}
                  {effectivePaymentType === "subscription" ? " (подписка)" : " (разовая)"}
                </p>
                <div className="rounded-md border bg-background p-2 font-mono text-xs break-all select-all">
                  {generatedUrl}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  className="w-full sm:flex-1 gap-2"
                  onClick={() => copyToClipboard(generatedUrl)}
                >
                  <Copy className="h-4 w-4" />
                  Копировать
                </Button>
                <Button
                  className="w-full sm:flex-1 gap-2"
                  onClick={() => window.open(generatedUrl, "_blank")}
                >
                  <ExternalLink className="h-4 w-4" />
                  Открыть
                </Button>
              </div>
              {effectiveTelegramUserId && (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  disabled={sendToTelegramMutation.isPending}
                  onClick={() => sendToTelegramMutation.mutate()}
                >
                  {sendToTelegramMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Отправить клиенту в Telegram
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setGeneratedUrl(null)}
              >
                Создать ещё одну ссылку
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* User info — только в contact mode */}
              {!isPublicMode && (
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <p className="font-medium truncate">{userName || "—"}</p>
                  <p className="text-sm text-muted-foreground truncate">{userEmail}</p>
                </div>
              )}

              {/* Product */}
              <div className="rounded-lg border bg-card p-4 space-y-2">
                <Label className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-500" />
                  Продукт
                </Label>
                {productsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-label="Продукт"
                      aria-expanded={productPickerOpen}
                      aria-haspopup="listbox"
                      aria-controls="admin-payment-product-listbox"
                      className="h-10 w-full justify-between gap-2 px-3 text-left font-normal"
                      onClick={() => {
                        setProductPickerOpen((current) => {
                          if (current) setProductSearch("");
                          return !current;
                        });
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {selectedProduct?.name || "Выберите продукт"}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                    {productPickerOpen && (
                      <div
                        data-testid="admin-payment-product-picker"
                        className="mt-2 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                      >
                      <div className="border-b p-2">
                        <Input
                          autoFocus
                          value={productSearch}
                          onChange={(event) => setProductSearch(event.target.value)}
                          placeholder="Найти продукт, например «20 поток»"
                          aria-label="Поиск продукта"
                          className="h-9"
                        />
                      </div>
                      <ScrollArea
                        data-testid="admin-payment-product-scroll-area"
                        className="h-[min(18rem,calc(100dvh-14rem))] max-h-[18rem]"
                      >
                        <div
                          id="admin-payment-product-listbox"
                          className="min-h-full p-1"
                          role="listbox"
                          aria-label="Список продуктов"
                        >
                        {paymentLinkProducts.length > 0 ? (
                          paymentLinkProducts.map((product) => {
                            const isSelected = product.id === selectedProductId;
                            return (
                              <button
                                key={product.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={cn(
                                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                                  isSelected && "bg-accent",
                                )}
                                onClick={() => {
                                  handleProductChange(product.id);
                                  setProductPickerOpen(false);
                                  setProductSearch("");
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mt-0.5 h-4 w-4 shrink-0",
                                    isSelected ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <span className="min-w-0 flex-1 break-words leading-5">
                                  {product.name}
                                </span>
                                {!product.is_active && (
                                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                                    Неактивен
                                  </Badge>
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                            Продукты не найдены
                          </p>
                        )}
                        </div>
                      </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tariff */}
              {selectedProductId && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <Label className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-indigo-500" />
                    Тариф
                  </Label>
                  {tariffsLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : tariffs && tariffs.length > 0 ? (
                    <Select value={selectedTariffId} onValueChange={handleTariffChange}>
                      <SelectTrigger aria-label="Тариф">
                        <SelectValue placeholder="Выберите тариф" />
                      </SelectTrigger>
                      <SelectContent container={selectPortalContainer}>
                        {tariffs.filter((t) => t.is_active).map((tariff) => (
                          <SelectItem key={tariff.id} value={tariff.id}>
                            {tariff.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">Нет доступных тарифов</p>
                  )}
                </div>
              )}

              {/* Phase 5-C/5-D + Phase 6-F — Способ оплаты для этой ссылки */}
              {selectedTariffId && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <Label>Способ оплаты для этой ссылки</Label>
                  <div className="flex flex-col gap-2">
                    {(() => {
                      // Phase 6-G: динамический hint «По настройке кнопки» в зависимости от
                      // allowed_payment_providers оффера.
                      const hasBp = offerAllowedProviders.includes("bepaid");
                      const hasSt = offerAllowedProviders.includes("stripe");
                      const autoHint =
                        hasBp && hasSt
                          ? "Клиент сможет выбрать белорусскую или иностранную карту"
                          : hasBp
                            ? "Будет использована белорусская карта (bePaid)"
                            : hasSt
                              ? "Будет использована иностранная карта (Stripe)"
                              : "Будут использованы настройки оплаты этой кнопки";
                      const ccHasBp = customerChoiceAllowed.includes("bepaid");
                      const ccHasSt = customerChoiceAllowed.includes("stripe");
                      const customerChoiceHint =
                        ccHasBp && ccHasSt
                          ? "Клиент сам выберет белорусскую или иностранную карту"
                          : ccHasBp
                            ? "Сейчас доступен только один способ оплаты: bePaid"
                            : ccHasSt
                              ? "Сейчас доступен только один способ оплаты: Stripe"
                              : "Нет доступных способов оплаты";
                      return [
                      {
                        key: "auto" as const,
                        title: "По настройке кнопки",
                        hint: autoHint,
                        icon: <MousePointerClick className="h-4 w-4 text-muted-foreground" />,
                        disabled: false,
                      },
                      {
                        key: "customer_choice" as const,
                        title: "Клиент выбирает",
                        hint: customerChoiceHint,
                        icon: <Users className="h-4 w-4 text-blue-500" />,
                        disabled: customerChoiceAllowed.length === 0,
                      },
                      {
                        key: "bepaid" as const,
                        title: "Белорусская карта (bePaid)",
                        // Phase 7-UI follow-up — reason от shared mirror; bePaid привязан к BYN.
                        hint: (() => {
                          const r = resolveProviderForUi("bepaid", "BYN");
                          return r.allowed ? "bePaid · BYN · локальные карты" : (r.message ?? "Способ оплаты недоступен");
                        })(),
                        icon: <CreditCard className="h-4 w-4 text-emerald-600" />,
                        disabled:
                          (!isSuperAdmin && !offerAllowedProviders.includes("bepaid")) ||
                          !resolveProviderForUi("bepaid", "BYN").allowed,
                      },

                      {
                        key: "stripe" as const,
                        title: "Иностранная карта / Apple Pay (Stripe)",
                        // Phase 7-UI follow-up — reason от shared mirror; currency = выбранная stripeCurrency.
                        hint: (() => {
                          const r = resolveProviderForUi("stripe", stripeCurrency);
                          return r.allowed
                            ? `Stripe · ${stripeCurrency} · карты других стран, Apple Pay`
                            : (r.message ?? "Способ оплаты недоступен");
                        })(),
                        icon: <CreditCard className="h-4 w-4 text-indigo-500" />,
                        disabled:
                          (!isSuperAdmin && !offerAllowedProviders.includes("stripe")) ||
                          isInstallmentOffer ||
                          !resolveProviderForUi("stripe", stripeCurrency).allowed,
                      },

                    ];
                    })().map((opt) => {
                      const selected = providerModeChoice === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => !opt.disabled && setProviderModeChoice(opt.key)}
                          disabled={opt.disabled}
                          className={cn(
                            "flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-all w-full",
                            selected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-background hover:border-primary/40",
                            opt.disabled && "opacity-50 cursor-not-allowed hover:border-border",
                          )}
                        >
                          <span className="mt-0.5 shrink-0">{opt.icon}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium text-foreground truncate">
                              {opt.title}
                            </span>
                            <span className="block text-xs text-muted-foreground mt-0.5 break-words">
                              {opt.hint}
                            </span>
                          </span>
                          {selected && (
                            <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {providerModeChoice !== "auto" && (
                    <p className="text-xs text-muted-foreground">
                      Изменение применяется только к этой оплате. Настройки кнопки оплаты не меняются.
                    </p>
                  )}
                </div>
              )}

              {/* Phase 4.1 — Технические настройки Stripe (показываем только для fixed=stripe) */}
              {selectedTariffId && providerModeChoice === "stripe" && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <Label>Настройки иностранного эквайринга</Label>
                  {/* Технические бутоны bePaid/Stripe удалены — выбор делает блок «Способ оплаты» выше. */}
                  {provider === "stripe" && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Stripe-подключение</Label>
                          <Select value={stripeAccountCode} onValueChange={setStripeAccountCode}>
                            <SelectTrigger><SelectValue placeholder="Выберите аккаунт" /></SelectTrigger>
                            <SelectContent container={selectPortalContainer}>
                              {(stripeAccounts ?? []).map((a: any) => {
                                const name = (a.account_name ?? "").trim() || "Stripe — подключение без названия";
                                return (
                                  <SelectItem key={a.account_code} value={a.account_code}>
                                    {name}
                                    {a.test_mode ? " · тестовое" : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Валюта</Label>
                          <Select
                            value={stripeCurrency}
                            onValueChange={(v) => {
                              setStripeCurrency(v);
                              setStripeCurrencyManuallySet(true);
                            }}
                          >

                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent container={selectPortalContainer}>
                              {STRIPE_CURRENCY_OPTIONS.map((code) => {
                                const check = isStripeCurrencyDisabled(code);
                                return (
                                  <SelectItem
                                    key={code}
                                    value={code}
                                    disabled={check.disabled}
                                    title={check.message ?? undefined}
                                  >
                                    {code}
                                    {check.disabled
                                      ? ` · ${check.message ?? "недоступно"}`
                                      : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {stripeInstallmentBlocked && (
                        <p className="text-xs text-destructive">
                          Рассрочка доступна только для bePaid. Для Stripe выберите другой тариф/кнопку.
                        </p>
                      )}
                      {stripeAccountMissing && (
                        <p className="text-xs text-destructive">
                          Нет активного Stripe-подключения. Добавьте его в Настройках эквайринга.
                        </p>
                      )}
                      {stripeCurrencyUnsupported && (
                        <p className="text-xs text-destructive">
                          {stripeCurrencyUnsupportedMessage ??
                            `Валюта ${stripeCurrency} не поддерживается выбранным Stripe-аккаунтом.`}
                          {" "}Выберите другую валюту или другое подключение.
                        </p>
                      )}
                      {provider === "stripe" && paymentType === "subscription" && (
                        <p className="text-xs text-muted-foreground">
                          Stripe-подписка будет создана по настройкам тарифа. Техническая привязка Stripe Price выполняется автоматически.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Сумма ссылки указана в основной валюте; Stripe принимает её в minor units автоматически.
                      </p>
                    </div>
                  )}
                </div>
              )}



              {/* Тип оплаты — крупные сегменты. Скрыто для installment-офферов
                  (срок рассрочки = свой селект ниже, payment_type форсится one_time). */}
              {selectedTariffId && !isInstallmentOffer && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <Label>Тип оплаты</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={lockPaymentTypeToSubscription}
                      onClick={() => {
                        if (lockPaymentTypeToSubscription) return;
                        setPaymentType("one_time");
                        setSelectedOfferId("");
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-all",
                        paymentType === "one_time"
                          ? "border-primary bg-primary/5 text-foreground shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        lockPaymentTypeToSubscription && "opacity-40 cursor-not-allowed hover:border-border hover:text-muted-foreground"
                      )}
                    >
                      <CreditCard className="h-5 w-5" />
                      Разовая оплата
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType("subscription");
                        setSelectedOfferId("");
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-all",
                        paymentType === "subscription"
                          ? "border-primary bg-primary/5 text-foreground shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      )}
                    >
                      <RefreshCw className="h-5 w-5" />
                      Подписка
                    </button>
                  </div>
                  {lockPaymentTypeToSubscription ? (
                    <p className="text-xs text-amber-600">
                      По настройке тарифа будет создана подписка (mode=subscription). В режиме «По настройке кнопки» система следует SOT оффера.
                    </p>
                  ) : warnExplicitOneTimeOnRecurringStripe ? (
                    <p className="text-xs text-amber-600">
                      Тариф является рекуррентным, но вы создаёте разовую админскую оплату. Подписка Stripe создана не будет (mode=payment).
                    </p>
                  ) : hintExplicitSubscriptionStripe ? (
                    <p className="text-xs text-muted-foreground">
                      Для Stripe будет создана подписка (mode=subscription).
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Предпочтение пользователя. Если в тарифе нет кнопки нужного типа, будет использована основная кнопка тарифа.
                    </p>
                  )}
                </div>
              )}


              {/* Stage L: read-only бейдж для installment-оффера */}
              {selectedTariffId && isInstallmentOffer && (
                <div className="rounded-lg border bg-amber-500/5 border-amber-500/40 p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-amber-600" />
                    <span className="font-medium text-sm">Тип оплаты: Рассрочка</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Серия из {selectedInstallmentMonths ?? "—"} платежей. Сегодня клиент оплачивает первый платёж, остальные списываются с карты автоматически каждые {Number((effectiveOffer as any)?.installment_interval_days ?? 30)} дней.
                  </p>
                </div>
              )}

              {/* Кнопка оплаты — резолвер с явным fallback */}
              {selectedTariffId && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <Label className="flex items-center gap-2">
                    <MousePointerClick className="h-4 w-4 text-primary" />
                    Кнопка оплаты
                  </Label>

                  {offersLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : resolved.ok === false ? (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <p>{resolved.message}</p>
                    </div>
                  ) : (
                    <>
                      <Select
                        value={effectiveOffer?.id || ""}
                        onValueChange={(v) => setSelectedOfferId(v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите кнопку…" />
                        </SelectTrigger>
                        <SelectContent container={selectPortalContainer}>
                          {visibleOffers.map((o) => {
                            const isSub = !!o.meta?.recurring?.is_recurring;
                            return (
                              <SelectItem key={o.id} value={o.id}>
                                {o.button_label} — {Number(o.amount)} {previewCurrency}
                                {isSub ? " · подписка" : " · разовая"}
                                {o.is_primary ? " · основная" : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>



                      {/* Audit-бейдж режима резолва */}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
                            isOverrideMode
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          )}
                        >
                          <Info className="h-3 w-3" />
                          {isOverrideMode
                            ? "Режим: Override"
                            : "Режим: Точное совпадение"}
                        </span>
                        <span className="text-muted-foreground">
                          Параметры берутся из кнопки «{effectiveOffer?.button_label}».
                        </span>
                      </div>

                      {/* Override warning — у тарифа нет кнопки нужного типа,
                          но ссылка всё равно создастся как payment_type выбора админа. */}
                      {isOverrideMode && (
                        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground">
                          <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                          <p>
                            У тарифа нет отдельной кнопки типа{" "}
                            <strong>
                              {paymentType === "subscription"
                                ? "«Подписка»"
                                : "«Разовая оплата»"}
                            </strong>
                            . Будет создана{" "}
                            <strong>
                              {paymentType === "subscription"
                                ? "подписочная"
                                : "разовая"}
                            </strong>{" "}
                            ссылка на основе текущего тарифа (цена, продукт,
                            описание из кнопки «{effectiveOffer?.button_label}»).
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground">
                        Сделка попадёт в воронку CRM согласно настройкам этой кнопки. Сумму ниже можно скорректировать — привязка к кнопке сохранится.
                      </p>
                    </>
                  )}
                </div>
              )}

              {selectedProductId && selectedTariffId && effectiveOffer && quoteMatchesCurrentOffer && (composableAvailableAddons.length > 0 || composableQuoteLoading) && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium">Дополнительные продукты</p>
                    <p className="text-xs text-muted-foreground">
                      Они войдут в одну сделку и общую сумму, а доступ будет выдан отдельно по каждой позиции.
                    </p>
                  </div>
                  <AddonPicker
                    addons={composableAvailableAddons as any}
                    selectedIds={selectedAddonOfferIds}
                    currency={composableCurrency}
                    loading={composableQuoteLoading}
                    density="admin"
                    onToggle={(id, next) =>
                      setSelectedAddonOfferIds((prev) =>
                        next
                          ? [...new Set([...prev, id])]
                          : prev.filter((x) => x !== id),
                      )
                    }
                  />
                  <div className="flex justify-between border-t pt-2 text-sm font-medium">
                    <span>Сумма комплекта до ручной корректировки</span>
                    <span>{composableSubtotal} {composableCurrency}</span>
                  </div>
                </div>
              )}

              {selectedProductId && selectedTariffId && effectiveOffer && quoteMatchesCurrentOffer && displayComposableItems.length > 0 && (
                <OrderSummary
                  items={displayComposableItems.map((it: any) => ({
                    role: it.role,
                    product_name: it.product_name,
                    tariff_name: it.tariff_name ?? null,
                    list_amount: Number(it.list_amount ?? 0),
                    final_amount: Number(it.final_amount ?? 0),
                    discount_amount: Number(it.discount_amount ?? 0),
                    discount_percent: it.discount_percent ?? null,
                    pricing_mode: it.pricing_mode,
                  })) as OrderSummaryLine[]}
                  currency={displayComposableCurrency}
                  total={amount}
                  subtotal={displayComposableSubtotal}
                  adjustmentAmount={displayComposableAdjustment}
                  adjustmentReason={adjustmentReason.trim() || null}
                  paymentMethodLabel={
                    invoicePanelOpen
                      ? "Счёт на юрлицо / ИП"
                      : rrPanelOpen
                        ? "Ресурс развития"
                        : paymentType === "subscription"
                          ? "Подписка (карта)"
                          : isInstallmentOffer
                            ? "Рассрочка (internal_installment)"
                            : "Карта"
                  }
                  density="admin"
                />
              )}



              {/* Сумма */}
              {selectedTariffId && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <Label htmlFor="link-amount">Сумма ({previewCurrency})</Label>
                  <Input
                    id="link-amount"
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="0.00"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    required
                  />
                  {!effectiveOffer && tariffPrices?.price && (
                    <p className="text-xs text-muted-foreground">
                      Цена тарифа: {tariffPrices.price} {previewCurrency}
                    </p>
                  )}
                  {isInstallmentOffer && (
                    <p className="text-xs text-muted-foreground">
                      Это полная стоимость продукта. Сумма каждого платежа рассчитывается автоматически по выбранному сроку рассрочки ниже.
                    </p>
                  )}
                  {displayComposableQuote && displayComposableAdjustment !== 0 && (
                    <div className="space-y-2 pt-2">
                      <Label htmlFor="adjustment-reason">
                        Причина {displayComposableAdjustment < 0 ? "скидки" : "наценки"}
                      </Label>
                      <Input
                        id="adjustment-reason"
                        value={adjustmentReason}
                        onChange={(e) => setAdjustmentReason(e.target.value)}
                        placeholder="Например: персональная скидка 10%"
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Корректировка: {displayComposableAdjustment > 0 ? "+" : ""}{displayComposableAdjustment} {displayComposableCurrency}.
                        Она применяется к общей сумме комплекта.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Индивидуальная ссылка: N всегда 2..12, независимо от настроек кнопки.
                  Админ может изменить количество платежей и сумму. Публичная кнопка не меняется.
                  Скрываем для invoice/RR — там нет рассрочки, только счёт/RR-ссылка. */}
              {selectedTariffId && isInstallmentOffer && !invoicePanelOpen && !rrPanelOpen && (() => {
                const intervalDays = Number((effectiveOffer as any)?.installment_interval_days ?? 30);
                const offerAmountByn = Number((effectiveOffer as any)?.amount ?? 0);
                const offerN = installmentMaxMonths ?? null;
                const pluralPayment = (n: number) =>
                  n === 1 ? "платёж" : n < 5 ? "платежа" : "платежей";
                const pluralDay = (n: number) =>
                  n === 1 ? "день" : n < 5 ? "дня" : "дней";
                const overrideN = selectedInstallmentMonths !== null && selectedInstallmentMonths !== offerN;
                const overrideAmount = offerAmountByn > 0 && amount > 0 && Math.round(amount) !== Math.round(offerAmountByn);
                return (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Параметры индивидуальной ссылки</p>
                    <p className="text-xs text-muted-foreground">
                      Кнопка используется как базовое предложение. Для этой индивидуальной ссылки можно изменить общую сумму и количество платежей. Настройки публичной кнопки при этом не изменятся.
                    </p>
                  </div>

                  {offerN && offerAmountByn > 0 && (
                    <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                      <p>Стандартные параметры кнопки:</p>
                      <p className="text-foreground">
                        {offerN} {pluralPayment(offerN)} · {offerAmountByn} {previewCurrency}
                      </p>
                    </div>
                  )}

                  <Label>Количество платежей</Label>
                  <Select
                    value={selectedInstallmentMonths ? String(selectedInstallmentMonths) : ""}
                    onValueChange={(v) => setSelectedInstallmentMonths(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите количество…" />
                    </SelectTrigger>
                    <SelectContent container={selectPortalContainer}>
                      {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {pluralPayment(n)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Доступно от 2 до 12 платежей. Настройки публичной кнопки не изменятся.
                  </p>

                  {selectedInstallmentMonths && amount > 0 && (() => {
                    const N = selectedInstallmentMonths;
                    const perPayment = Math.ceil(amount / N);
                    const totalInstallment = perPayment * N;
                    const diff = totalInstallment - amount;
                    return (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
                        <p className="text-sm">Параметры этой ссылки:</p>
                        <p className="text-sm">
                          <b>{N} {pluralPayment(N)}</b> · <b>{amount} {previewCurrency}</b>
                        </p>
                        <p className="text-sm">Один платёж: <b>{perPayment} {previewCurrency}</b></p>
                        <p className="text-sm">Итоговая сумма: <b>{totalInstallment} {previewCurrency}</b></p>
                        {diff !== 0 && (
                          <p className="text-xs text-muted-foreground">
                            Разница из-за округления вверх до целых {previewCurrency}: +{diff} {previewCurrency}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Первый платёж — сегодня, далее каждые {intervalDays} {pluralDay(intervalDays)}.
                        </p>
                        {(overrideN || overrideAmount) && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Индивидуальные параметры отличаются от кнопки. Кнопка на сайте не изменится.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
                );
              })()}
              {isCurrentConflict && conflictData && (
                <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <p className="text-sm font-medium">Активная подписка уже существует</p>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Статус: {conflictData.status}</p>
                    {conflictData.display_next_charge_at && (
                      <p>
                        Следующее списание:{" "}
                        {formatPaymentTimeIANA(
                          conflictData.display_next_charge_at,
                          conflictData.timezone_used || "Europe/Minsk"
                        )}
                      </p>
                    )}
                    {conflictData.display_access_end_at && (
                      <p>
                        Доступ до:{" "}
                        {formatPaymentTimeIANA(
                          conflictData.display_access_end_at,
                          conflictData.timezone_used || "Europe/Minsk"
                        )}
                      </p>
                    )}
                    {conflictData.bepaid_subscription_id && (
                      <p>bePaid ID: {conflictData.bepaid_subscription_id}</p>
                    )}
                  </div>
                  {replaceStep !== "idle" && replaceStep !== "error" ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {replaceStep === "cancelling" && "Отменяем текущую подписку…"}
                      {replaceStep === "creating" && "Создаём новую ссылку…"}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => setConflictData(null)}
                      >
                        Оставить текущую подписку
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="text-xs"
                        disabled={replaceSubscriptionMutation.isPending}
                        onClick={handleReplaceSubscription}
                      >
                        Заменить подписку (отменить старую)
                      </Button>
                    </div>
                  )}
                  {replaceStep === "error" && (
                    <p className="text-xs text-destructive mt-1">
                      Ошибка замены. Попробуйте снова или отмените вручную.
                    </p>
                  )}
                </div>
              )}

              {/* Description */}
              {selectedTariffId && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <Label htmlFor="link-description">Комментарий (опционально)</Label>
                  <Textarea
                    id="link-description"
                    placeholder="Описание для клиента..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
              )}

              {/* Summary */}
              {selectedProduct && selectedTariff && amount > 0 && effectiveOffer && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
                  <p className="font-medium">Ссылка на оплату:</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedProduct.name} — {selectedTariff.name}
                  </p>
                  {isInstallmentOffer && selectedInstallmentMonths ? (
                    <>
                      <p className="text-lg font-bold">
                        {selectedInstallmentMonths} × {Math.ceil(amount / selectedInstallmentMonths)} {previewCurrency} = ИТОГО {Math.ceil(amount / selectedInstallmentMonths) * selectedInstallmentMonths} {previewCurrency}
                      </p>
                      <p className="text-xs text-muted-foreground">Рассрочка · первый платёж сегодня, далее каждые {Number((effectiveOffer as any)?.installment_interval_days ?? 30)} дней</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold">{amount} {previewCurrency}</p>
                      <p className="text-xs text-muted-foreground">
                        {effectivePaymentType === "subscription" ? "Подписка (ежемесячно)" : "Разовая оплата"}
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Sprint «Составные продажи ЦБ» — дополнительные сценарии checkout.
                  Кнопки видны только если у тарифа есть sibling offer соответствующего типа. */}
              {selectedTariffId && (invoiceSiblingOffer || rrSiblingOffer) && (
                <div className="rounded-lg border bg-card/50 p-3 space-y-3">
                  <p className="text-sm font-medium">Дополнительные сценарии оплаты</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {invoiceSiblingOffer && (
                      <Button
                        type="button"
                        variant={invoicePanelOpen ? "default" : "outline"}
                        size="sm"
                        onClick={() => { setInvoicePanelOpen((v) => !v); setRrPanelOpen(false); }}
                      >
                        Счёт для юрлица/ИП
                      </Button>
                    )}
                    {rrSiblingOffer && (
                      <Button
                        type="button"
                        variant={rrPanelOpen ? "default" : "outline"}
                        size="sm"
                        onClick={() => { setRrPanelOpen((v) => !v); setInvoicePanelOpen(false); }}
                      >
                        Ресурс развития
                      </Button>
                    )}
                  </div>

                  {invoicePanelOpen && invoiceSiblingOffer && (
                    <div className="space-y-3 pt-2 border-t">
                      {siblingCompositionPending && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Сопоставляем модули и рассчитываем сумму счёта…
                        </p>
                      )}
                      {siblingCompositionError && (
                        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {siblingCompositionError}
                        </p>
                      )}
                      <div className="space-y-1.5">
                        <Label>Плательщик</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {(["legal_entity", "entrepreneur", "individual"] as const).map((t) => (
                            <Button
                              key={t}
                              type="button"
                              size="sm"
                              variant={invoicePayerType === t ? "default" : "outline"}
                              onClick={() => setInvoicePayerType(t)}
                            >
                              {t === "legal_entity" ? "ЮЛ" : t === "entrepreneur" ? "ИП" : "ФЛ"}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {invoicePayerType !== "individual" && (
                        <div className="space-y-1.5">
                          <Label>Реквизиты плательщика</Label>
                          {(targetLegalDetails ?? []).length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              У контакта нет карточек реквизитов. Добавьте их из карточки контакта.
                            </p>
                          ) : (
                            <select
                              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                              value={invoiceLegalDetailsId}
                              onChange={(e) => setInvoiceLegalDetailsId(e.target.value)}
                            >
                              <option value="">— выберите —</option>
                              {(targetLegalDetails ?? [])
                                .filter((d: any) =>
                                  invoicePayerType === "legal_entity"
                                    ? d.client_type === "legal_entity"
                                    : d.client_type === "entrepreneur",
                                )
                                .map((d: any) => (
                                  <option key={d.id} value={d.id}>
                                    {d.leg_org_form ? `${d.leg_org_form} ` : ""}
                                    {d.leg_name || d.ent_name || "—"}
                                    {d.leg_unp || d.ent_unp ? ` · УНП ${d.leg_unp || d.ent_unp}` : ""}
                                    {d.is_default ? " · основные" : ""}
                                  </option>
                                ))}
                            </select>
                          )}
                        </div>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        disabled={
                          invoicePending ||
                          !selectedProductId ||
                          siblingCompositionPending ||
                          !!siblingCompositionError ||
                          !siblingQuoteMatchesCurrentOffer
                        }
                        onClick={handleIssueInvoice}
                      >
                        {invoicePending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Выписать счёт
                      </Button>
                    </div>
                  )}

                  {rrPanelOpen && rrSiblingOffer && (
                    <div className="space-y-3 pt-2 border-t">
                      <p className="text-xs text-muted-foreground">
                        Будет создана ссылка через Ресурс развития на общую сумму состава.
                      </p>
                      {siblingCompositionPending && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Сопоставляем модули RR и рассчитываем сумму…
                        </p>
                      )}
                      {siblingQuoteMatchesCurrentOffer && !siblingCompositionError && (
                        <p className="text-xs text-muted-foreground">
                          Состав RR до ручной корректировки: {siblingComposableSubtotal}{" "}
                          {siblingComposableCurrency}. Итог ссылки: {amount}{" "}
                          {siblingComposableCurrency}.
                        </p>
                      )}
                      {siblingCompositionError && (
                        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {siblingCompositionError}
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        disabled={
                          rrPending ||
                          !selectedProductId ||
                          siblingCompositionPending ||
                          !!siblingCompositionError ||
                          !siblingQuoteMatchesCurrentOffer
                        }
                        onClick={handleInitiateRr}
                      >
                        {rrPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Сформировать ссылку RR
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="h-9 w-full px-3"
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={effectiveTelegramUserId ? "outline" : "default"}
                  disabled={isCreateDisabled || combinedPending}
                  onClick={() => createPublicLinkMutation.mutate()}
                  className="h-9 w-full px-3"
                >
                  {createPublicLinkMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2 shrink-0" />
                  )}
                  <span className="whitespace-nowrap">Создать ссылку</span>
                </Button>
                {effectiveTelegramUserId && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isCreateDisabled || combinedPending}
                    onClick={handleCreateAndSendTelegram}
                    className="h-9 w-full px-3 sm:col-span-2"
                  >
                    {combinedPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                    ) : (
                      <Send className="h-4 w-4 mr-2 shrink-0" />
                    )}
                    <span className="whitespace-nowrap">Создать и отправить</span>
                  </Button>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить подписку?</AlertDialogTitle>
            <AlertDialogDescription>
              Текущая подписка будет отменена у провайдера. После успешной отмены будет создана новая ссылка на оплату. Если отмена не пройдёт, новая подписка не будет создана.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Нет, оставить</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace}>Да, заменить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!invoiceIssueResult}
        onOpenChange={(v) => { if (!v) setInvoiceIssueResult(null); }}
      >
        <DialogContent className="sm:max-w-[560px] p-0 flex flex-col gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
            <DialogTitle>Счёт выписан</DialogTitle>
            <DialogDescription>
              Проверьте, что PDF сформирован и оба канала доставки отработали.
            </DialogDescription>
          </DialogHeader>
          {invoiceIssueResult && (
            <InvoiceDeliverySuccess
              documentId={invoiceIssueResult.document_id}
              invoiceNumber={invoiceIssueResult.invoice_number}
              documentNumber={invoiceIssueResult.document_number}
              documentIssuedAt={invoiceIssueResult.document_issued_at}
              orderId={invoiceIssueResult.order_id}
              onDocumentReady={(r) =>
                setInvoiceIssueResult((prev) =>
                  prev
                    ? {
                        ...prev,
                        document_id: r.document_id,
                        document_number: r.document_number ?? prev.document_number,
                        document_issued_at:
                          r.document_issued_at ?? prev.document_issued_at,
                      }
                    : prev,
                )
              }
              onClose={() => setInvoiceIssueResult(null)}
              layout="dialog"
            />
          )}

        </DialogContent>
      </Dialog>
    </>
  );
}
