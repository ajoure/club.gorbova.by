import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, RotateCcw, Ban } from "lucide-react";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";

interface PaymentsAnalyticsProps {
  payments: UnifiedPayment[];
  isLoading: boolean;
}

interface AnalyticCardProps {
  title: string;
  amount: number;
  currency: string;
  icon: React.ReactNode;
  colorClass: string;
  bgColorClass: string;
}

function AnalyticCard({ title, amount, currency, icon, colorClass, bgColorClass }: AnalyticCardProps) {
  const formatAmount = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl p-4",
      "backdrop-blur-xl border border-border/50",
      bgColorClass
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg",
          "bg-background/80",
          colorClass
        )}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5">{title}</p>
          <div className="flex items-baseline gap-1.5">
            <span className={cn("text-xl font-bold tabular-nums", colorClass)}>
              {formatAmount(amount)}
            </span>
            <span className="text-sm text-muted-foreground">{currency}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentsAnalytics({ payments, isLoading }: PaymentsAnalyticsProps) {
  const analytics = useMemo(() => {
    if (!payments.length) {
      return {
        successful: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        refunded: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        failed: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        primaryCurrency: 'BYN',
      };
    }

    const result = {
      successful: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      refunded: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      failed: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
    };

    const currencyCount: Record<string, number> = {};

    payments.forEach(p => {
      const currency = p.currency || 'BYN';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;

      if (['successful', 'succeeded'].includes(p.status_normalized)) {
        result.successful[currency] = (result.successful[currency] || 0) + p.amount;
      } else if (p.status_normalized === 'failed') {
        result.failed[currency] = (result.failed[currency] || 0) + p.amount;
      }

      if (p.total_refunded > 0) {
        result.refunded[currency] = (result.refunded[currency] || 0) + p.total_refunded;
      }
    });

    // Determine primary currency (most common)
    const primaryCurrency = Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'BYN';

    return { ...result, primaryCurrency };
  }, [payments]);

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const { primaryCurrency } = analytics;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
        <DollarSign className="h-4 w-4" />
        Финансовая сводка за период
      </h3>
      
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <AnalyticCard
          title="Успешные платежи"
          amount={analytics.successful[primaryCurrency] || 0}
          currency={primaryCurrency}
          icon={<TrendingUp className="h-5 w-5" />}
          colorClass="text-green-600 dark:text-green-400"
          bgColorClass="bg-green-500/5 dark:bg-green-500/10"
        />
        
        <AnalyticCard
          title="Возвраты"
          amount={analytics.refunded[primaryCurrency] || 0}
          currency={primaryCurrency}
          icon={<RotateCcw className="h-5 w-5" />}
          colorClass="text-amber-600 dark:text-amber-400"
          bgColorClass="bg-amber-500/5 dark:bg-amber-500/10"
        />
        
        <AnalyticCard
          title="Ошибочные"
          amount={analytics.failed[primaryCurrency] || 0}
          currency={primaryCurrency}
          icon={<Ban className="h-5 w-5" />}
          colorClass="text-red-600 dark:text-red-400"
          bgColorClass="bg-red-500/5 dark:bg-red-500/10"
        />
      </div>
      
      {/* Show other currencies if present */}
      {Object.keys(analytics.successful).filter(c => c !== primaryCurrency && analytics.successful[c] > 0).length > 0 && (
        <div className="text-xs text-muted-foreground mt-2">
          {Object.entries(analytics.successful)
            .filter(([c, v]) => c !== primaryCurrency && v > 0)
            .map(([currency, amount]) => (
              <span key={currency} className="mr-3">
                +{amount.toFixed(2)} {currency}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
