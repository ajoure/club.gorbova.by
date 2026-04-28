import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Link2, Copy, ExternalLink, Loader2, Layers, Tag, CheckCircle, Send,
  AlertTriangle, MousePointerClick, CreditCard, RefreshCw, Info
} from "lucide-react";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { useTariffOffers, type TariffOffer } from "@/hooks/useTariffOffers";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { formatPaymentTimeIANA } from "@/lib/formatPaymentTime";
import { cn } from "@/lib/utils";

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
  const [selectedProductId, setSelectedProductId] = useState<string>("");
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

  const { data: products, isLoading: productsLoading } = useProductsV2();
  const { data: tariffs, isLoading: tariffsLoading } = useTariffs(selectedProductId);
  const { data: allOffers, isLoading: offersLoading } = useTariffOffers(
    selectedTariffId || undefined
  );

  // Резолвер: работает на ВСЕХ offers (без предварительной фильтрации по типу).
  const resolved = useMemo(
    () => resolveCanonicalOffer(allOffers, paymentType),
    [allOffers, paymentType]
  );

  // Effective offer: пользовательский override (если выбран и валиден) > resolver
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
    const metaMax = Number((effectiveOffer as any).meta?.installment?.max_months ?? 0);
    if (metaMax >= 2) return Math.min(12, metaMax);
    const legacy = Number((effectiveOffer as any).installment_count ?? 0);
    if (legacy >= 2) return Math.min(12, legacy);
    return null;
  }, [isInstallmentOffer, effectiveOffer]);
  // per_payment для installment считается inline в JSX (там, где amount уже доступен).

  // Список всех active pay_now offers (для select override) — без фильтрации по типу
  const activeOffers = useMemo(
    () => (allOffers || []).filter((o) => o.is_active && o.offer_type === "pay_now"),
    [allOffers]
  );

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

  // Reset на смене продукта
  useEffect(() => {
    setSelectedTariffId("");
    setSelectedOfferId("");
    setCustomAmount("");
    setGeneratedUrl(null);
    setConflictData(null);
    setReplaceStep("idle");
    setShowCancelConfirm(false);
  }, [selectedProductId]);

  // Reset offer override на смене тарифа
  useEffect(() => {
    setSelectedOfferId("");
    setCustomAmount("");
    setGeneratedUrl(null);
    setConflictData(null);
    setReplaceStep("idle");
    setShowCancelConfirm(false);
  }, [selectedTariffId]);

  // Сбрасывать stale conflict при смене типа оплаты или конкретного offer
  useEffect(() => {
    setConflictData(null);
    setReplaceStep("idle");
    setShowCancelConfirm(false);
  }, [paymentType, selectedOfferId]);

  // Автоподстановка суммы при смене effective offer.
  // ВАЖНО: offer.amount хранится в BYN — НЕ делить на 100.
  useEffect(() => {
    if (effectiveOffer) {
      setCustomAmount(String(Number(effectiveOffer.amount)));
      setGeneratedUrl(null);
      // Stage L: если оффер installment — выставляем default = max_months и форсим one_time.
      if ((effectiveOffer as any).payment_method === "internal_installment") {
        const metaMax = Number((effectiveOffer as any).meta?.installment?.max_months ?? 0);
        const legacy = Number((effectiveOffer as any).installment_count ?? 0);
        const max = Math.min(12, metaMax >= 2 ? metaMax : (legacy >= 2 ? legacy : 0));
        setSelectedInstallmentMonths(max >= 2 ? max : null);
        if (paymentType !== "one_time") setPaymentType("one_time");
      } else {
        setSelectedInstallmentMonths(null);
      }
    } else if (
      !resolved.ok &&
      tariffPrices?.price &&
      !customAmount
    ) {
      setCustomAmount(String(tariffPrices.price));
      setSelectedInstallmentMonths(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveOffer?.id]);

  // Reset при закрытии диалога
  useEffect(() => {
    if (!open) {
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
    }
  }, [open]);

  // PATCH PAYMENT-CONFLICT v3: конфликт product-level (без tariff_id) и только для подписки.
  const isCurrentConflict = useMemo(() => {
    if (!conflictData) return false;
    if (effectivePaymentType !== "subscription") return false;
    return conflictData.product_id === selectedProductId;
  }, [conflictData, effectivePaymentType, selectedProductId]);

  const selectedProduct = products?.find((p) => p.id === selectedProductId);
  const selectedTariff = tariffs?.find((t) => t.id === selectedTariffId);
  const amount = parseFloat(customAmount) || 0;

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
      if (!data.success && data.error === "existing_subscription_conflict" && data.conflict) {
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
            // Stage L: installment payload (writer ignore-ит, если поля null/false).
            ...(isInstallmentOffer && selectedInstallmentMonths
              ? {
                  installment_offer: true,
                  selected_installment_months: selectedInstallmentMonths,
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

  const sendToTelegramMutation = useMutation({
    mutationFn: async () => {
      if (!generatedUrl || !selectedProduct || !selectedTariff) {
        throw new Error("Нет данных для отправки");
      }
      const isInstallmentMsg = isInstallmentOffer && (selectedInstallmentMonths ?? 0) >= 2;
      const typeLabel = isInstallmentMsg
        ? `Рассрочка · ${selectedInstallmentMonths} платежей`
        : effectivePaymentType === "subscription"
          ? "Подписка (ежемесячно)"
          : "Разовая оплата";
      const perPayment = Math.round(amount / (selectedInstallmentMonths || 1));
      const totalAmount = perPayment * (selectedInstallmentMonths || 1);
      const amountLine = isInstallmentMsg
        ? `💰 Стоимость: ${selectedInstallmentMonths} × ${perPayment} BYN (итого ${totalAmount} BYN)`
        : `💰 Стоимость: ${amount} BYN`;
      const telegramMessage = `💳 *Оплата ${isInstallmentMsg ? "в рассрочку" : "подписки"}*

📦 Продукт: ${selectedProduct.name}
📋 Тариф: ${selectedTariff.name}
${amountLine}
📅 Тип: ${typeLabel}`;

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
            ...(isInstallmentOffer && selectedInstallmentMonths
              ? {
                  installment_offer: true,
                  selected_installment_months: selectedInstallmentMonths,
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
        const typeLabel =
          effectivePaymentType === "subscription"
            ? "Подписка (ежемесячно)"
            : "Разовая оплата";
        const telegramMessage = `💳 *Оплата подписки*

📦 Продукт: ${selectedProduct?.name}
📋 Тариф: ${selectedTariff?.name}
💰 Стоимость: ${amount} BYN
📅 Тип: ${typeLabel}`;
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

  const activeProducts = products?.filter((p) => p.is_active) || [];

  // Stage L: для installment селект срока ОБЯЗАТЕЛЕН.
  const installmentInvalid =
    isInstallmentOffer &&
    (!selectedInstallmentMonths ||
      !installmentMaxMonths ||
      selectedInstallmentMonths < 2 ||
      selectedInstallmentMonths > installmentMaxMonths);

  const isCreateDisabled =
    createLinkMutation.isPending ||
    createPublicLinkMutation.isPending ||
    !selectedProductId ||
    !selectedTariffId ||
    !effectiveOffer ||
    amount <= 0 ||
    isCurrentConflict ||
    installmentInvalid;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
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
                  {selectedProduct?.name} — {selectedTariff?.name} · {amount} BYN
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
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите продукт" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeProducts.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    <Select value={selectedTariffId} onValueChange={setSelectedTariffId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тариф" />
                      </SelectTrigger>
                      <SelectContent>
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

              {/* Тип оплаты — крупные сегменты. Скрыто для installment-офферов
                  (срок рассрочки = свой селект ниже, payment_type форсится one_time). */}
              {selectedTariffId && !isInstallmentOffer && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <Label>Тип оплаты</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType("one_time");
                        setSelectedOfferId("");
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-all",
                        paymentType === "one_time"
                          ? "border-primary bg-primary/5 text-foreground shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
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
                  <p className="text-xs text-muted-foreground">
                    Предпочтение пользователя. Если в тарифе нет кнопки нужного типа, будет использована основная кнопка тарифа.
                  </p>
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
                    Серия из {selectedInstallmentMonths ?? "—"} ежемесячных платежей. Сегодня клиент оплачивает первый платёж, остальные списываются с карты автоматически каждые 30 дней.
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
                        <SelectContent>
                          {activeOffers.map((o) => {
                            const isSub = !!o.meta?.recurring?.is_recurring;
                            return (
                              <SelectItem key={o.id} value={o.id}>
                                {o.button_label} — {Number(o.amount)} BYN
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

              {/* Сумма */}
              {selectedTariffId && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <Label htmlFor="link-amount">Сумма (BYN)</Label>
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
                      Цена тарифа: {tariffPrices.price} BYN
                    </p>
                  )}
                  {isInstallmentOffer && (
                    <p className="text-xs text-muted-foreground">
                      Это полная стоимость продукта. Сумма каждого платежа рассчитывается автоматически по выбранному сроку рассрочки ниже.
                    </p>
                  )}
                </div>
              )}

              {/* Stage L: Селектор срока рассрочки + блок суммы */}
              {selectedTariffId && isInstallmentOffer && installmentMaxMonths && installmentMaxMonths >= 2 && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <Label>Срок рассрочки</Label>
                  <Select
                    value={selectedInstallmentMonths ? String(selectedInstallmentMonths) : ""}
                    onValueChange={(v) => setSelectedInstallmentMonths(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите срок…" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: installmentMaxMonths - 1 }, (_, i) => i + 2).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {n === 1 ? "месяц" : n < 5 ? "месяца" : "месяцев"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Выберите, на сколько месяцев создать рассрочку для клиента. Доступны варианты 2–{installmentMaxMonths} (зависит от настроек кнопки в тарифе).
                  </p>

                  {selectedInstallmentMonths && amount > 0 && (() => {
                    const N = selectedInstallmentMonths;
                    const perPayment = Math.round(amount / N);
                    const totalInstallment = perPayment * N;
                    const diff = totalInstallment - amount;
                    return (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1">
                        <p className="text-base font-semibold">
                          {N} платеж{N === 1 ? "" : N < 5 ? "а" : "ей"} × {perPayment} BYN = ИТОГО {totalInstallment} BYN
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Сумма платежа округлена до целых BYN. Итог рассрочки рассчитан с учётом выбранного срока и может отличаться от полной цены ({amount} BYN
                          {diff !== 0 ? `, разница: ${diff > 0 ? "+" : ""}${diff} BYN` : ""}).
                          Списание происходит каждые 30 дней. Первый платёж — сегодня.
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
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
                        {selectedInstallmentMonths} × {Math.round(amount / selectedInstallmentMonths)} BYN = ИТОГО {Math.round(amount / selectedInstallmentMonths) * selectedInstallmentMonths} BYN
                      </p>
                      <p className="text-xs text-muted-foreground">Рассрочка · первый платёж сегодня, далее каждые 30 дней</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold">{amount} BYN</p>
                      <p className="text-xs text-muted-foreground">
                        {effectivePaymentType === "subscription" ? "Подписка (ежемесячно)" : "Разовая оплата"}
                      </p>
                    </>
                  )}
                </div>
              )}

              <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="w-full sm:w-auto"
                >
                  Отмена
                </Button>
                {/*
                  Кнопки одного диалога — все используют canonical writers
                  (admin-create-public-link). Никакого нового payment-path.
                */}
                <Button
                  type="button"
                  variant={effectiveTelegramUserId ? "outline" : "default"}
                  disabled={isCreateDisabled || combinedPending}
                  onClick={() => createPublicLinkMutation.mutate()}
                  className="w-full sm:w-auto min-w-0"
                >
                  {createPublicLinkMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2 shrink-0" />
                  )}
                  <span className="truncate">Создать ссылку</span>
                </Button>
                {effectiveTelegramUserId && (
                  <Button
                    type="button"
                    disabled={isCreateDisabled || combinedPending}
                    onClick={handleCreateAndSendTelegram}
                    className="w-full sm:w-auto min-w-0"
                  >
                    {combinedPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                    ) : (
                      <Send className="h-4 w-4 mr-2 shrink-0" />
                    )}
                    <span className="truncate">Создать и отправить</span>
                  </Button>
                )}
              </DialogFooter>
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
    </>
  );
}
