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
  link_user_id: string | null;
  installment?: InstallmentInfo | null;
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
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [replaceStep, setReplaceStep] = useState<'idle' | 'cancelling' | 'creating'>('idle');

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
    enabled: !!user?.id,
    retry: false,
  });

  // PAY-D: pick default saved-card selection once cards are loaded.
  // HOTFIX: must be ABOVE all early returns to satisfy Rules of Hooks.
  // Recomputed null-safe — linkInfo may still be undefined here.
  const _isSubscriptionEarly = linkInfo?.payment_type === 'subscription';
  const _ownsOrPublicEarly =
    !!user &&
    !!linkInfo &&
    (linkInfo.link_user_id === null || linkInfo.link_user_id === user.id);
  const _showSavedCardSelectorEarly =
    _ownsOrPublicEarly &&
    !_isSubscriptionEarly &&
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

  const initiatePayment = async (payerEmail?: string, replacementId?: string) => {
    if (!token) return;
    setIsProcessing(true);
    setError(null);
    setIdentityError(null);

    try {
      const body: Record<string, unknown> = { url_token: token };
      if (payerEmail) body.email = payerEmail;
      if (replacementId) body.replacement_of_subscription_v2_id = replacementId;

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
      if (data?.error === 'existing_subscription_conflict' && data?.conflict) {
        setConflictData(data.conflict as SubscriptionConflictInfo);
        setIsProcessing(false);
        return;
      }
      if (!res.ok || !data.redirect_url) {
        // Identity-resolution error → keep inline auth open, surface inside form
        if (res.status === 400 && data.error === 'identity_required') {
          setIdentityError('Не удалось подтвердить аккаунт. Войдите или завершите регистрацию ниже.');
          setIsProcessing(false);
          return;
        }
        throw new Error(data.error || 'Не удалось создать платёж');
      }
      window.location.href = data.redirect_url;
    } catch (err) {
      setError(normalizeEdgeFunctionError(err));
      setIsProcessing(false);
    }
  };

  // Branch A: target user pre-bound — no email, server uses link.user_id only
  const handlePayWithTarget = () => initiatePayment(undefined);

  // Branch B: no target user, but session — Bearer token will be picked up live
  const handlePayWithSession = () => initiatePayment(user?.email || undefined);

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
        window.location.href = data.redirect_url;
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
  // Иначе one_time-ссылка на subscription-продукт показывалась бы как «Подписка».
  const getTypeLabel = (paymentType: string, category: string | null) => {
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

  // PAY-D visibility: NULL OR equal — public link OR personal link of current user.
  const ownsOrPublic =
    !!user &&
    (linkInfo.link_user_id === null || linkInfo.link_user_id === user.id);
  // PAY-D: saved-card selector — one_time only (subscription handled by PAY-E).
  const showSavedCardSelector =
    ownsOrPublic &&
    !isSubscription &&
    Array.isArray(savedCards) &&
    savedCards.length > 0;
  // PAY-E-LITE: для subscription показываем сохранённые карты в disabled-режиме + уведомление.
  const showSubscriptionDisabledCards =
    ownsOrPublic &&
    isSubscription &&
    Array.isArray(savedCards) &&
    savedCards.length > 0;
  const showSubscriptionFallbackHint = ownsOrPublic && isSubscription;

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
              <p className="text-muted-foreground">{getTypeLabel(linkInfo.payment_type, linkInfo.product_category)}</p>
            </div>

            {linkInfo.description && (
              <p className="text-center text-muted-foreground mb-6">{linkInfo.description}</p>
            )}

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
                <span>Безопасная оплата через bePaid</span>
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
                    Списание происходит каждые {linkInfo.installment.interval_days ?? 30} дней. Сегодня вы оплачиваете первый платёж — {priceFormatted}.
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

            {/* Non-identity payment errors only — identity errors stay inside form */}
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm mb-4 p-3 rounded-md bg-destructive/10">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {conflictData && linkInfo.payment_type === 'subscription' && (
              <Alert className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <Repeat className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-200">
                  У вас уже есть активная подписка на этот продукт
                </AlertTitle>
                <AlertDescription className="space-y-3 text-amber-800 dark:text-amber-200">
                  <p>Можно оставить текущую подписку или заменить её новой оплатой.</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => setConflictData(null)}>
                      Оставить текущую
                    </Button>
                    <Button type="button" size="sm" className="flex-1" disabled={isProcessing || replaceStep !== 'idle'} onClick={() => setShowReplaceConfirm(true)}>
                      {replaceStep !== 'idle' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Repeat className="mr-2 h-4 w-4" />}
                      Заменить подписку
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* PAY-D: Unified payment method selector (one_time + auth + cards),
                otherwise single CTA. Subscription always goes through standard bePaid checkout. */}
            {!needsIdentity && showSavedCardSelector && (
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

            {!needsIdentity && (
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  if (showSavedCardSelector && selectedMethod !== 'new_card') {
                    handlePayWithSavedCard(selectedMethod);
                  } else if (linkInfo.has_target_user) {
                    handlePayWithTarget();
                  } else {
                    handlePayWithSession();
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

            {!needsIdentity && showSavedCardSelector && selectedMethod !== 'new_card' && (
              <p className="mt-2 text-[11px] text-center text-muted-foreground">
                Подтверждение банка может потребоваться при первой оплате этой картой.
              </p>
            )}

            {/* PAY-E-LITE: для subscription показываем сохранённые карты disabled + уведомление.
                Логика checkout не меняется — CTA уходит в стандартный bePaid subscription flow. */}
            {!needsIdentity && showSubscriptionDisabledCards && (
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

            {!needsIdentity && showSubscriptionFallbackHint && (
              <p className="mt-3 text-xs text-center text-muted-foreground leading-relaxed">
                Эта ссылка оформляет подписку bePaid. Сохранённые карты нельзя выбрать для оформления
                подписки. Вас перенаправит на защищённую страницу bePaid, где нужно будет ввести карту
                для подписки.
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
