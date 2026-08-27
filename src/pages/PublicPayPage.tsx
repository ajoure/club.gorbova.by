/**
 * PublicPayPage — /pay/:token public payment page.
 *
 * Canonical contract (see mem://commercial-logic/payments/public-checkout-architecture):
 *   payment_links.user_id = RECIPIENT of order/access/CRM-deal — NOT a payer guard.
 *   Anyone may open and pay a public link. Login is NEVER required when target user
 *   is pre-bound on the link.
 *
 * Three UI states:
 *   1) has_target_user=true            → product card + Pay button (no email/login)
 *   2) !has_target_user && auth.user   → Pay button, email auto-taken from session
 *   3) !has_target_user && guest       → inline email → login/signup (useInlineAuth),
 *                                        link-context preserved on same /pay/:token
 */

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeEdgeFunctionError } from '@/utils/normalizeEdgeFunctionError';
import { SAVED_CARD_PAYMENTS_ENABLED } from '@/config/paymentFeatures';
import { getAccessAwareUrl } from '@/utils/accessAlias';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineAuthForm } from '@/components/auth/InlineAuthForm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cancelOldSubscriptionForReplacement, type SubscriptionConflictInfo } from '@/lib/subscriptionReplacement';
import { CreditCard, CheckCircle, Clock, Shield, AlertCircle, Loader2, Repeat, Plus } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomerProviderChoice } from '@/components/payments/CustomerProviderChoice';
import { resolveProviderChoice, type CustomerProvider } from '@/utils/resolveCustomerProviderChoice';

interface InstallmentInfo {
  payment_method?: string;
  max_installment_months?: number;
  selected_installment_months?: number;
  interval_days?: number;
  first_payment_delay_days?: number;
  total_amount?: number;            // BYN
  per_payment_amount?: number;      // BYN
  total_installment_amount?: number; // BYN
  rounding_mode?: string;
}

interface PaymentLinkInfo {
  product_id: string;
  product_name: string;
  product_description: string | null;
  product_category: string | null;
  tariff_name: string | null;
  access_days: number | null;
  amount: number; // kopecks (для installment — per_payment_kopecks)
  currency: string;
  description: string | null;
  payment_type: string;
  has_target_user: boolean;
  requires_identity_input: boolean;
  requires_auth: boolean;
  link_user_id: string | null;
  installment?: InstallmentInfo | null;
  // Phase 5-C — provider routing surface
  provider?: 'bepaid' | 'stripe' | null;
  provider_mode?: 'fixed' | 'customer_choice' | null;
  allowed_payment_providers?: ('bepaid' | 'stripe')[] | null;
  composable_checkout?: {
    currency: string;
    subtotal: number;
    adjustment_amount: number;
    adjustment_reason?: string | null;
    total: number;
    items: Array<{
      role: 'primary' | 'addon';
      product_name: string;
      tariff_name: string;
      list_amount: number;
      discount_amount: number;
      final_amount: number;
    }>;
  } | null;
}

interface SavedCard {
  id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
}

export default function PublicPayPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<SubscriptionConflictInfo | null>(null);
  const [activeSubscriptionData, setActiveSubscriptionData] = useState<SubscriptionConflictInfo | null>(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [replaceStep, setReplaceStep] = useState<'idle' | 'cancelling' | 'creating'>('idle');
  const [useCustomerCredit, setUseCustomerCredit] = useState(false);
  const [usePartnerBonus, setUsePartnerBonus] = useState(false);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const functionUrl = `https://${projectId}.supabase.co/functions/v1/public-checkout`;
  const savedCardFunctionUrl = `https://${projectId}.supabase.co/functions/v1/public-charge-saved-card`;
  const [savedCardProcessing, setSavedCardProcessing] = useState(false);
  // PAY-D: unified payment method selector. 'new_card' or payment_method_id (uuid).
  const [selectedMethod, setSelectedMethod] = useState<string>('new_card');
  // Stable per-mount idempotency key — survives multiple clicks within the same /pay/:token visit.
  const savedCardIdempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const { data: linkInfo, isLoading, error: loadError } = useQuery({
    queryKey: ['public-pay', token],
    queryFn: async (): Promise<PaymentLinkInfo> => {
      const res = await fetch(`${functionUrl}?token=${token}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Ссылка недействительна');
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  // PAY-C: load user's active saved cards (NEVER select provider_token).
  const { data: savedCards } = useQuery({
    queryKey: ['public-pay-saved-cards', user?.id],
    queryFn: async (): Promise<SavedCard[]> => {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, brand, last4, exp_month, exp_year, is_default')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SavedCard[];
    },
    enabled: SAVED_CARD_PAYMENTS_ENABLED && !!user?.id,
    retry: false,
  });

  const { data: customerCredit } = useQuery({
    queryKey: ['referral-customer-credit', user?.id],
    queryFn: async (): Promise<{ available_minor: number; currency: string }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('referral_get_my_customer_credit');
      if (error) throw error;
      return data ?? { available_minor: 0, currency: 'BYN' };
    },
    enabled: !!user?.id,
    retry: false,
  });

  const { data: partnerBonus } = useQuery({
    queryKey: ['referral-partner-bonus', user?.id, linkInfo?.product_id],
    queryFn: async (): Promise<{ available_minor: number; eligible: boolean }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('referral_get_my_bonus_wallet', { p_product_id: linkInfo?.product_id });
      if (error) throw error;
      return data ?? { available_minor: 0, eligible: false };
    },
    enabled: !!user && !!linkInfo?.product_id,
    retry: false,
  });

  // PAY-D: pick default saved-card selection once cards are loaded.
  // HOTFIX: must be ABOVE all early returns to satisfy Rules of Hooks.
  // Recomputed null-safe — linkInfo may still be undefined here.
  const _isSubscriptionEarly = linkInfo?.payment_type === 'subscription';
  const _isInstallmentEarly =
    !!linkInfo?.installment &&
    Number(linkInfo.installment.selected_installment_months ?? 0) >= 2;
  const _ownsOrPublicEarly =
    !!user &&
    !!linkInfo &&
    (linkInfo.link_user_id === null || linkInfo.link_user_id === user.id);
  const _showSavedCardSelectorEarly =
    SAVED_CARD_PAYMENTS_ENABLED &&
    _ownsOrPublicEarly &&
    !_isSubscriptionEarly &&
    !_isInstallmentEarly &&
    Array.isArray(savedCards) &&
    savedCards.length > 0;

  useEffect(() => {
    if (!_showSavedCardSelectorEarly) {
      if (selectedMethod !== 'new_card') setSelectedMethod('new_card');
      return;
    }
    if (selectedMethod !== 'new_card' && savedCards!.some((c) => c.id === selectedMethod)) return;
    const def = savedCards!.find((c) => c.is_default) || savedCards![0];
    setSelectedMethod(def?.id || 'new_card');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_showSavedCardSelectorEarly, savedCards]);

  const initiatePayment = async (
    payerEmail?: string,
    replacementId?: string,
    providerChoice?: CustomerProvider,
  ) => {
    if (!token) return;
    setIsProcessing(true);
    setError(null);
    setIdentityError(null);
    setActiveSubscriptionData(null);

    try {
      const body: Record<string, unknown> = { url_token: token };
      if (payerEmail) body.email = payerEmail;
      if (replacementId) body.replacement_of_subscription_v2_id = replacementId;
      if (providerChoice) body.provider_choice = providerChoice;
      if (useCustomerCredit && customerCredit?.available_minor) {
        body.customer_credit_requested_minor = customerCredit.available_minor;
        body.customer_credit_checkout_key = savedCardIdempotencyKeyRef.current;
      }
      if (usePartnerBonus && partnerBonus?.eligible && partnerBonus.available_minor) {
        body.partner_bonus_requested_minor = partnerBonus.available_minor;
        body.partner_bonus_checkout_key = savedCardIdempotencyKeyRef.current;
      }

      // ALWAYS read access token immediately before POST (post-inline-login session)
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const res = await fetch(functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data?.error === 'already_has_active_subscription' && data?.conflict) {
        setConflictData(data.conflict as SubscriptionConflictInfo);
        setIsProcessing(false);
        return;
      }
      if (data?.error === 'existing_subscription_conflict' && data?.conflict) {
        setConflictData(data.conflict as SubscriptionConflictInfo);
        setIsProcessing(false);
        return;
      }
      if (!res.ok || !data.redirect_url) {
        if (res.status === 401 && data.error === 'authentication_required') {
          setIdentityError('Сессия истекла. Войдите снова, чтобы продолжить оплату.');
          setIsProcessing(false);
          return;
        }
        // Identity-resolution error → keep inline auth open, surface inside form
        if (res.status === 400 && data.error === 'identity_required') {
          setIdentityError('Не удалось подтвердить аккаунт. Войдите или завершите регистрацию ниже.');
          setIsProcessing(false);
          return;
        }
        throw new Error(data.error || 'Не удалось создать платёж');
      }
      window.location.href = getAccessAwareUrl(data.redirect_url);
    } catch (err) {
      setError(normalizeEdgeFunctionError(err));
      setIsProcessing(false);
    }
  };

  // Phase 5-C — состояние выбора провайдера для customer_choice ссылок.
  const [chosenProvider, setChosenProvider] = useState<CustomerProvider | null>(null);

  // Branch A: target user pre-bound — no email, server uses link.user_id only
  const handlePayWithTarget = (providerChoice?: CustomerProvider) =>
    initiatePayment(undefined, undefined, providerChoice);

  // Branch B: no target user, but session — Bearer token will be picked up live
  const handlePayWithSession = (providerChoice?: CustomerProvider) =>
    initiatePayment(user?.email || undefined, undefined, providerChoice);

  const handleReplaceSubscription = async () => {
    if (!conflictData) return;
    setShowReplaceConfirm(false);
    setReplaceStep('cancelling');
    setError(null);
    try {
      await cancelOldSubscriptionForReplacement({
        conflict: conflictData,
        source: 'public_link_replace',
      });
      setReplaceStep('creating');
      await initiatePayment(user?.email || undefined, conflictData.subscription_v2_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось заменить подписку');
      setIsProcessing(false);
    } finally {
      setReplaceStep('idle');
    }
  };

  // Auto-pay when guest finishes inline auth (Bearer token from fresh session)
  const handleGuestAuthenticated = async (email: string) => {
    await initiatePayment(email);
  };

  // PAY-C: pay with a saved card (MIT). Server enforces ownership and idempotency.
  const handlePayWithSavedCard = async (paymentMethodId: string) => {
    if (!token) return;
    setSavedCardProcessing(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Войдите в аккаунт, чтобы использовать сохранённую карту.');
      }
      const idempotency_key = savedCardIdempotencyKeyRef.current;
      const res = await fetch(savedCardFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          url_token: token,
          payment_method_id: paymentMethodId,
          idempotency_key,
          customer_credit_requested_minor:
            useCustomerCredit && customerCredit?.available_minor
              ? customerCredit.available_minor
              : 0,
          partner_bonus_requested_minor:
            usePartnerBonus && partnerBonus?.eligible ? partnerBonus.available_minor : 0,
          partner_bonus_checkout_key: savedCardIdempotencyKeyRef.current,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Existing active attempt — DO NOT auto-retry, DO NOT follow stale redirect_url.
        setError(data?.message || 'Платёж уже создан. Завершите подтверждение или попробуйте позже.');
        return;
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || data?.error || 'Не удалось списать сохранённую карту');
      }
      // Issuer may require additional bank confirmation → follow redirect when present.
      if (data.redirect_url) {
        window.location.href = getAccessAwareUrl(data.redirect_url);
        return;
      }
      window.location.href = `/purchases?order=${data.order_id}&payment=processing`;
    } catch (err) {
      setError(normalizeEdgeFunctionError(err));
    } finally {
      setSavedCardProcessing(false);
    }
  };

  const formatPrice = (kopecks: number, currency: string) =>
    `${(kopecks / 100).toFixed(2)} ${currency}`;

  // Тип ссылки имеет приоритет над категорией продукта.
  // Для installment-ссылок (one_time + meta.installment >= 2) показываем «Рассрочка».
  const getTypeLabel = (
    paymentType: string,
    category: string | null,
    installmentMonths?: number
  ) => {
    if (installmentMonths && installmentMonths >= 2) {
      return `Рассрочка · ${installmentMonths} платежа`;
    }
    if (paymentType === 'one_time') return 'Разовый платёж';
    if (paymentType === 'subscription') return 'Подписка';
    switch (category) {
      case 'subscription': return 'Подписка';
      case 'course': return 'Курс';
      case 'webinar': return 'Вебинар';
      case 'consultation': return 'Консультация';
      default: return 'Продукт';
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-md mx-auto text-center">
            <GlassCard className="p-8">
              <div className="text-6xl mb-4">🔗</div>
              <h1 className="text-2xl font-bold mb-4">Ссылка не найдена</h1>
              <p className="text-muted-foreground">Проверьте правильность ссылки для оплаты.</p>
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-lg mx-auto">
            <GlassCard className="p-8">
              <Skeleton className="h-8 w-3/4 mx-auto mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-2/3 mb-6" />
              <Skeleton className="h-12 w-full" />
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  if (loadError || !linkInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-md mx-auto text-center">
            <GlassCard className="p-8">
              <div className="text-6xl mb-4">😕</div>
              <h1 className="text-2xl font-bold mb-4">Ссылка недействительна</h1>
              <p className="text-muted-foreground mb-2">
                {(loadError as Error)?.message || 'Ссылка для оплаты устарела или была деактивирована.'}
              </p>
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  const isInstallment = !!linkInfo.installment && (linkInfo.installment.selected_installment_months ?? 0) >= 2;
  // Для installment платёжная сумма в bePaid checkout = per_payment (link.amount уже = per_payment_kopecks).
  const priceFormatted = formatPrice(linkInfo.amount, linkInfo.currency);
  const needsIdentity = linkInfo.requires_identity_input && !user;
  const isSubscription = linkInfo.payment_type === 'subscription';
  const customerCreditAvailable = Number(customerCredit?.available_minor ?? 0);
  const canUseCustomerCredit = !!user && (!isSubscription || isInstallment) && customerCreditAvailable > 0;
  const customerCreditToApply = canUseCustomerCredit && useCustomerCredit
    ? Math.min(customerCreditAvailable, Math.max(0, linkInfo.amount - 100))
    : 0;
  const activeUntil = activeSubscriptionData?.access_end_at
    ? new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Minsk',
      }).format(new Date(activeSubscriptionData.access_end_at))
    : null;
  const partnerBonusAvailable = Number(partnerBonus?.eligible ? partnerBonus.available_minor : 0);
  const canUsePartnerBonus = !!user && (!isSubscription || isInstallment) && partnerBonusAvailable > 0;
  const partnerBonusToApply = canUsePartnerBonus && usePartnerBonus
    ? Math.min(partnerBonusAvailable, Math.max(0, linkInfo.amount - 100))
    : 0;

  // PAY-D visibility: NULL OR equal — public link OR personal link of current user.
  const ownsOrPublic =
    !!user &&
    (linkInfo.link_user_id === null || linkInfo.link_user_id === user.id);
  // PAY-D: saved-card selector — one_time only (subscription handled by PAY-E).
  const showSavedCardSelector =
    SAVED_CARD_PAYMENTS_ENABLED &&
    ownsOrPublic &&
    !isSubscription &&
    !isInstallment &&
    Array.isArray(savedCards) &&
    savedCards.length > 0;
  // PATCH: для Stripe subscription не показываем disabled bePaid saved-cards и не пишем
  // bePaid-specific fallback hint. Saved cards в системе — это bePaid токены, а Stripe
  // subscription уводит пользователя в Stripe Checkout, где он сам выбирает карту/Apple Pay.
  const isStripeSubscription = isSubscription && linkInfo.provider === 'stripe';
  // PAY-E-LITE: для bePaid subscription показываем сохранённые карты в disabled-режиме + уведомление.
  const showSubscriptionDisabledCards =
    SAVED_CARD_PAYMENTS_ENABLED &&
    ownsOrPublic &&
    isSubscription &&
    !isStripeSubscription &&
    Array.isArray(savedCards) &&
    savedCards.length > 0;
  const showSubscriptionFallbackHint =
    SAVED_CARD_PAYMENTS_ENABLED && ownsOrPublic && isSubscription && !isStripeSubscription;
  const showStripeSubscriptionHint = ownsOrPublic && isStripeSubscription;


  // Phase 5-C — customer provider choice gating.
  // HOTFIX provider_choice_required: согласовано с backend.
  //   • customer_choice + allowed.length===0 → конфиг-ошибка, оплата заблокирована;
  //   • customer_choice + allowed.length===1 → авто-выбор (backend подхватит);
  //   • customer_choice + allowed.length >1 → показываем CustomerProviderChoice.
  const providerResolution = resolveProviderChoice({
    allowed_payment_providers: linkInfo.allowed_payment_providers ?? undefined,
    default_provider: (linkInfo.provider as CustomerProvider | null) ?? undefined,
  });
  const isCustomerChoiceMode =
    linkInfo.provider_mode === 'customer_choice' && providerResolution.mode === 'choice';
  const needsProviderChoice = isCustomerChoiceMode && !chosenProvider;
  const isProviderMisconfigured =
    linkInfo.provider_mode === 'customer_choice' &&
    Array.isArray(linkInfo.allowed_payment_providers) &&
    linkInfo.allowed_payment_providers.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-24">
        <div className="max-w-lg mx-auto">
          <GlassCard className="p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <CreditCard className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{linkInfo.product_name}</h1>
              <p className="text-muted-foreground">{getTypeLabel(linkInfo.payment_type, linkInfo.product_category, linkInfo.installment?.selected_installment_months)}</p>
            </div>

            {linkInfo.description && (
              <p className="text-center text-muted-foreground mb-6">{linkInfo.description}</p>
            )}

            {linkInfo.composable_checkout?.items?.length ? (
              <div className="rounded-lg border bg-card/50 p-4 mb-6 space-y-2">
                <p className="text-sm font-medium">Состав покупки</p>
                {linkInfo.composable_checkout.items.map((item, index) => (
                  <div key={`${item.product_name}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{item.product_name}</span>
                      <span className="block text-xs text-muted-foreground">{item.tariff_name}</span>
                    </span>
                    <span className="whitespace-nowrap">{item.final_amount} {linkInfo.composable_checkout!.currency}</span>
                  </div>
                ))}
                {linkInfo.composable_checkout.adjustment_amount !== 0 && (
                  <div className="flex justify-between border-t pt-2 text-sm text-muted-foreground">
                    <span>{linkInfo.composable_checkout.adjustment_reason || "Корректировка менеджера"}</span>
                    <span>
                      {linkInfo.composable_checkout.adjustment_amount > 0 ? "+" : ""}
                      {linkInfo.composable_checkout.adjustment_amount} {linkInfo.composable_checkout.currency}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 font-semibold">
                  <span>Итого</span>
                  <span>{linkInfo.composable_checkout.total} {linkInfo.composable_checkout.currency}</span>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm">
                <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                <span>Мгновенный доступ после оплаты</span>
              </div>
              {linkInfo.access_days && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <span>
                    {isSubscription
                      ? `Срок действия: ${linkInfo.access_days} дней`
                      : `Доступ на ${linkInfo.access_days} дней`}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Shield className="h-5 w-5 text-primary shrink-0" />
                <span>Безопасная оплата по защищённому соединению</span>
              </div>
            </div>

            <div className="text-center mb-6">
              {isInstallment && linkInfo.installment ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Рассрочка</p>
                  <div className="text-4xl font-bold text-primary">
                    {linkInfo.installment.selected_installment_months} × {linkInfo.installment.per_payment_amount} {linkInfo.currency}
                  </div>
                  <p className="text-base font-medium">
                    Итого: {linkInfo.installment.total_installment_amount} {linkInfo.currency}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Сумма платежа округлена до целых {linkInfo.currency}. Итог рассрочки рассчитан с учётом выбранного срока и может отличаться от полной цены ({linkInfo.installment.total_amount} {linkInfo.currency}).
                    Вас перенаправит на защищённую страницу bePaid для оформления рассрочки. bePaid автоматически спишет {linkInfo.installment.selected_installment_months} платежей раз в {linkInfo.installment.interval_days ?? 30} дней и завершит подписку.
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-4xl font-bold text-primary mb-1">{priceFormatted}</div>
                  {isSubscription && linkInfo.access_days ? (
                    <p className="text-sm text-muted-foreground">за {linkInfo.access_days} дней</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">разовый платёж</p>
                  )}
                </>
              )}
            </div>

            {canUseCustomerCredit && (
              <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-lg border bg-primary/5 p-4 text-left">
                <Checkbox
                  checked={useCustomerCredit}
                  onCheckedChange={(checked) => setUseCustomerCredit(checked === true)}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Использовать накопленную скидку</span>
                  <span className="block text-xs text-muted-foreground">
                    Доступно {(customerCreditAvailable / 100).toFixed(2)} BYN
                    {useCustomerCredit && customerCreditToApply > 0
                      ? ` · к оплате будет зачтено ${(customerCreditToApply / 100).toFixed(2)} BYN`
                      : ''}
                  </span>
                </span>
              </label>
            )}

            {canUsePartnerBonus && (
              <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-50/50 p-4 text-left dark:bg-emerald-950/20">
                <Checkbox checked={usePartnerBonus} onCheckedChange={(checked) => setUsePartnerBonus(checked === true)} className="mt-0.5" />
                <span className="space-y-1"><span className="block text-sm font-medium">Использовать партнёрские баллы</span><span className="block text-xs text-muted-foreground">Доступно {(partnerBonusAvailable / 100).toFixed(2)} BYN{usePartnerBonus && partnerBonusToApply > 0 ? ` · к оплате будет зачтено ${(partnerBonusToApply / 100).toFixed(2)} BYN` : ''}</span></span>
              </label>
            )}

            {isSubscription && !isInstallment && customerCreditAvailable > 0 && (
              <p className="mb-6 rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                Накопленная скидка не применяется к подписке с автоплатежом. Её можно использовать при следующей разовой покупке или рассрочке.
              </p>
            )}

            {/* Non-identity payment errors only — identity errors stay inside form */}
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm mb-4 p-3 rounded-md bg-destructive/10">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {activeSubscriptionData && linkInfo.payment_type === 'subscription' && (
              <Alert className="mb-4 border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/20">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <AlertTitle className="text-emerald-800 dark:text-emerald-200">
                  Подписка уже оплачена и активна
                </AlertTitle>
                <AlertDescription className="text-emerald-800 dark:text-emerald-200">
                  Повторное списание не выполнялось.
                  {activeUntil ? ` Доступ действует до ${activeUntil}.` : ' Доступ уже продлён.'}
                </AlertDescription>
              </Alert>
            )}

            {conflictData && linkInfo.payment_type === 'subscription' && (
              <Alert className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <Repeat className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-200">
                  Новую подписку пока создать нельзя
                </AlertTitle>
                <AlertDescription className="space-y-3 text-amber-800 dark:text-amber-200">
                  <p>У вас уже есть действующая или ожидающая оплаты подписка на этот продукт.</p>
                  <p>Чтобы исключить двойное списание, сначала отмените её.</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => setConflictData(null)}>
                      Оставить текущую
                    </Button>
                    <Button type="button" size="sm" className="flex-1" disabled={isProcessing || replaceStep !== 'idle'} onClick={() => setShowReplaceConfirm(true)}>
                      {replaceStep !== 'idle' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Repeat className="mr-2 h-4 w-4" />}
                      Отменить старую и создать новую
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Phase 5-C — выбор способа оплаты (карта белорусского / иностранного банка).
                Показывается только для customer_choice ссылок с multi-provider оффером. */}
            {!needsIdentity && needsProviderChoice && (
              <div className="mb-4">
                <CustomerProviderChoice
                  onSelect={(p) => {
                    setChosenProvider(p);
                    if (linkInfo.has_target_user) {
                      handlePayWithTarget(p);
                    } else {
                      handlePayWithSession(p);
                    }
                  }}
                  loadingProvider={isProcessing ? chosenProvider : null}
                  disabled={isProcessing}
                />
              </div>
            )}

            {/* PAY-D: Unified payment method selector (one_time + auth + cards),
                otherwise single CTA. Subscription always goes through standard bePaid checkout. */}
            {!needsIdentity && !needsProviderChoice && showSavedCardSelector && (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Способ оплаты
                </div>
                <RadioGroup
                  value={selectedMethod}
                  onValueChange={setSelectedMethod}
                  className="space-y-2"
                  disabled={isProcessing || savedCardProcessing}
                >
                  {savedCards!.map((card) => (
                    <Label
                      key={card.id}
                      htmlFor={`pm-${card.id}`}
                      className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-accent/50 cursor-pointer transition-colors"
                    >
                      <RadioGroupItem id={`pm-${card.id}`} value={card.id} />
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-sm">
                        {(card.brand || 'CARD').toUpperCase()} ••••{card.last4 || '****'}
                      </span>
                      {card.is_default && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          по умолчанию
                        </span>
                      )}
                    </Label>
                  ))}
                  <Label
                    htmlFor="pm-new"
                    className="flex items-center gap-3 p-3 rounded-md border border-dashed border-border hover:bg-accent/50 cursor-pointer transition-colors"
                  >
                    <RadioGroupItem id="pm-new" value="new_card" />
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-sm">Новая карта</span>
                  </Label>
                </RadioGroup>
              </div>
            )}

            {!needsIdentity && !needsProviderChoice && isProviderMisconfigured && (
              <Alert className="mb-4 border-destructive/50 bg-destructive/10">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <AlertTitle>Оплата временно недоступна</AlertTitle>
                <AlertDescription>
                  Для этой ссылки не настроены доступные способы оплаты. Свяжитесь с менеджером.
                </AlertDescription>
              </Alert>
            )}

            {!needsIdentity && !needsProviderChoice && !isProviderMisconfigured && !activeSubscriptionData && (
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  const choice = isCustomerChoiceMode ? (chosenProvider ?? undefined) : undefined;
                  if (showSavedCardSelector && selectedMethod !== 'new_card') {
                    handlePayWithSavedCard(selectedMethod);
                  } else if (linkInfo.has_target_user) {
                    handlePayWithTarget(choice);
                  } else {
                    handlePayWithSession(choice);
                  }
                }}
                disabled={isProcessing || savedCardProcessing}
              >
                {(isProcessing || savedCardProcessing) ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Обработка...</>
                ) : (
                  <><CreditCard className="mr-2 h-5 w-5" /> Оплатить {priceFormatted}</>
                )}
              </Button>
            )}

            {!needsIdentity && !needsProviderChoice && showSavedCardSelector && selectedMethod !== 'new_card' && (
              <p className="mt-2 text-[11px] text-center text-muted-foreground">
                Подтверждение банка может потребоваться при первой оплате этой картой.
              </p>
            )}

            {/* PAY-E-LITE: для subscription показываем сохранённые карты disabled + уведомление.
                Логика checkout не меняется — CTA уходит в стандартный subscription flow. */}
            {!needsIdentity && !needsProviderChoice && showSubscriptionDisabledCards && (
              <div className="mt-4 mb-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Сохранённые карты
                </div>
                <div className="space-y-2 opacity-60 pointer-events-none select-none" aria-disabled="true">
                  {savedCards!.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-center gap-3 p-3 rounded-md border border-border"
                    >
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-sm">
                        {(card.brand || 'CARD').toUpperCase()} ••••{card.last4 || '****'}
                      </span>
                      {card.is_default && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          по умолчанию
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!needsIdentity && !needsProviderChoice && showSubscriptionFallbackHint && (
              <p className="mt-3 text-xs text-center text-muted-foreground leading-relaxed">
                Эта ссылка оформляет подписку. Сохранённые карты нельзя выбрать для оформления
                подписки. Вас перенаправит на защищённую страницу платёжного провайдера, где
                нужно будет ввести карту для подписки.
              </p>
            )}

            {!needsIdentity && !needsProviderChoice && showStripeSubscriptionHint && (
              <p className="mt-3 text-xs text-center text-muted-foreground leading-relaxed">
                Для оформления подписки вы будете перенаправлены на защищённую страницу Stripe,
                где можно ввести новую карту или использовать Apple Pay, если он доступен.
              </p>
            )}


            {/* State 3: guest + no target user → shared inline auth (email/login/signup/forgot) */}
            {needsIdentity && (
              <>
                {identityError && (
                  <div className="flex items-center gap-2 text-destructive text-sm mb-3 p-3 rounded-md bg-destructive/10">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{identityError}</span>
                  </div>
                )}
                <InlineAuthForm
                  initialEmail={user?.email || ''}
                  onAuthenticated={handleGuestAuthenticated}
                  contextNote="Для оформления оплаты подтвердите email или войдите в аккаунт."
                  emailCtaLabel="Продолжить"
                  loginCtaLabel="Войти и оплатить"
                  signupCtaLabel="Зарегистрироваться и оплатить"
                  externalLoading={isProcessing}
                />
              </>
            )}

            <p className="text-xs text-center text-muted-foreground mt-4">
              Нажимая кнопку, вы соглашаетесь с{' '}
              <a href="/offer" className="text-primary hover:underline">условиями оферты</a>
            </p>
          </GlassCard>
        </div>
      </main>

      <LandingFooter />

      <AlertDialog open={showReplaceConfirm} onOpenChange={setShowReplaceConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить текущую подписку?</AlertDialogTitle>
            <AlertDialogDescription>
              Старая подписка будет отменена, после этого откроется новая страница оплаты.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleReplaceSubscription}>Заменить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
