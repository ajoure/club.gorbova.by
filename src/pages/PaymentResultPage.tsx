/**
 * PaymentResultPage — /payment/result public page.
 * Shows payment result based on query params from bePaid redirect.
 */

import { useSearchParams, Link } from 'react-router-dom';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function PaymentResultPage() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');
  const orderId = searchParams.get('order_id');

  const isSuccess = status === 'success';
  const isDeclined = status === 'declined' || status === 'decline';
  const isFailed = status === 'failed' || status === 'fail';

  const icon = isSuccess
    ? <CheckCircle className="h-16 w-16 text-green-500" />
    : isDeclined
    ? <XCircle className="h-16 w-16 text-destructive" />
    : <AlertTriangle className="h-16 w-16 text-yellow-500" />;

  const title = isSuccess
    ? 'Оплата успешна!'
    : isDeclined
    ? 'Оплата отклонена'
    : isFailed
    ? 'Ошибка оплаты'
    : 'Результат оплаты';

  const description = isSuccess
    ? 'Ваш платёж обработан. Доступ будет предоставлен автоматически.'
    : isDeclined
    ? 'Банк отклонил операцию. Попробуйте другую карту или повторите позже.'
    : isFailed
    ? 'Произошла ошибка при обработке платежа. Попробуйте ещё раз.'
    : 'Статус платежа неизвестен.';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-24">
        <div className="max-w-md mx-auto text-center">
          <GlassCard className="p-8">
            <div className="flex justify-center mb-6">{icon}</div>
            <h1 className="text-2xl font-bold mb-4">{title}</h1>
            <p className="text-muted-foreground mb-6">{description}</p>

            {orderId && (
              <p className="text-xs text-muted-foreground mb-6">
                Номер заказа: <span className="font-mono">{orderId}</span>
              </p>
            )}

            <div className="flex flex-col gap-3">
              {isSuccess ? (
                <Button asChild>
                  <Link to="/purchases">Мои покупки</Link>
                </Button>
              ) : (
                <Button variant="outline" onClick={() => window.history.back()}>
                  Попробовать снова
                </Button>
              )}
              <Button variant="ghost" asChild>
                <Link to="/">На главную</Link>
              </Button>
            </div>
          </GlassCard>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
