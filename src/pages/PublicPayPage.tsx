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

import { useState, useEffect } from 'react';
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
import { CreditCard, CheckCircle, Clock, Shield, AlertCircle, Loader2 } from 'lucide-react';

interface PaymentLinkInfo {
  product_name: string;
  product_description: string | null;
  product_category: string | null;
  tariff_name: string | null;
  access_days: number | null;
  amount: number; // kopecks
  currency: string;
  description: string | null;
  payment_type: string;
  has_target_user: boolean;
  requires_identity_input: boolean;
}

export default function PublicPayPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const functionUrl = `https://${projectId}.supabase.co/functions/v1/public-checkout`;

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

  const initiatePayment = async (payerEmail?: string) => {
    if (!token) return;
    setIsProcessing(true);
    setError(null);
    setIdentityError(null);

    try {
      const body: Record<string, unknown> = { url_token: token };
      if (payerEmail) body.email = payerEmail;

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

  // Auto-pay when guest finishes inline auth (Bearer token from fresh session)
  const handleGuestAuthenticated = async (email: string) => {
    await initiatePayment(email);
  };

  const formatPrice = (kopecks: number, currency: string) =>
    `${(kopecks / 100).toFixed(2)} ${currency}`;

  const getCategoryLabel = (category: string | null) => {
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

  const priceFormatted = formatPrice(linkInfo.amount, linkInfo.currency);
  const needsIdentity = linkInfo.requires_identity_input && !user;

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
              <p className="text-muted-foreground">{getCategoryLabel(linkInfo.product_category)}</p>
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
                  <span>Срок действия: {linkInfo.access_days} дней</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Shield className="h-5 w-5 text-primary shrink-0" />
                <span>Безопасная оплата через bePaid</span>
              </div>
            </div>

            <div className="text-center mb-6">
              <div className="text-4xl font-bold text-primary mb-1">{priceFormatted}</div>
              {linkInfo.access_days && (
                <p className="text-sm text-muted-foreground">за {linkInfo.access_days} дней</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm mb-4 p-3 rounded-md bg-destructive/10">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* States 1 & 2: pre-bound target user OR session user → just pay */}
            {!needsIdentity && (
              <Button
                size="lg"
                className="w-full"
                onClick={linkInfo.has_target_user ? handlePayWithTarget : handlePayWithSession}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Обработка...</>
                ) : (
                  <><CreditCard className="mr-2 h-5 w-5" /> Оплатить {priceFormatted}</>
                )}
              </Button>
            )}

            {/* State 3: guest + no target user → shared inline auth (email/login/signup/forgot) */}
            {needsIdentity && (
              <InlineAuthForm
                initialEmail={user?.email || ''}
                onAuthenticated={handleGuestAuthenticated}
                contextNote="Для оформления оплаты подтвердите email или войдите в аккаунт."
                emailCtaLabel="Продолжить"
                loginCtaLabel="Войти и оплатить"
                signupCtaLabel="Зарегистрироваться и оплатить"
                externalLoading={isProcessing}
              />
            )}

            <p className="text-xs text-center text-muted-foreground mt-4">
              Нажимая кнопку, вы соглашаетесь с{' '}
              <a href="/offer" className="text-primary hover:underline">условиями оферты</a>
            </p>
          </GlassCard>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
