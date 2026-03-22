/**
 * PublicPayPage — /pay/:token public payment page.
 * Loads payment link info via edge function, shows product details, initiates checkout.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
}

export default function PublicPayPage() {
  const { token } = useParams<{ token: string }>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handlePay = async () => {
    if (!token) return;
    setIsProcessing(true);
    setError(null);

    try {
      // Get current user session if logged in
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;

      const res = await fetch(functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url_token: token, email }),
      });

      const data = await res.json();

      if (!res.ok || !data.redirect_url) {
        throw new Error(data.error || 'Не удалось создать платёж');
      }

      window.location.href = data.redirect_url;
    } catch (err: any) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  const formatPrice = (kopecks: number, currency: string) => {
    return `${(kopecks / 100).toFixed(2)} ${currency}`;
  };

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

            <Button size="lg" className="w-full" onClick={handlePay} disabled={isProcessing}>
              {isProcessing ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Обработка...</>
              ) : (
                <><CreditCard className="mr-2 h-5 w-5" /> Оплатить {priceFormatted}</>
              )}
            </Button>

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
