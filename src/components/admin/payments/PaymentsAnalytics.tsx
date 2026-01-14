import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, RotateCcw, Ban, Percent, Wallet } from "lucide-react";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type AnalyticsFilter = 'successful' | 'refunded' | 'failed' | 'fees' | 'net' | null;

interface PaymentsAnalyticsProps {
  payments: UnifiedPayment[];
  isLoading: boolean;
  activeFilter?: AnalyticsFilter;
  onFilterChange?: (filter: AnalyticsFilter) => void;
}

interface AnalyticCardProps {
  title: string;
  amount: number;
  currency: string;
  icon: React.ReactNode;
  colorClass: string;
  bgColorClass: string;
  isClickable?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  tooltip?: string;
  subtitle?: string;
}

function AnalyticCard({ 
  title, 
  amount, 
  currency, 
  icon, 
  colorClass, 
  bgColorClass,
  isClickable = false,
  isActive = false,
  onClick,
  tooltip,
  subtitle,
}: AnalyticCardProps) {
  const formatAmount = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const content = (
    <div 
      className={cn(
        "relative overflow-hidden rounded-xl p-4",
        "backdrop-blur-xl border border-border/50",
        bgColorClass,
        isClickable && "cursor-pointer transition-all hover:scale-[1.02] hover:border-primary/50",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
      onClick={isClickable ? onClick : undefined}
    >
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
          {subtitle && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export default function PaymentsAnalytics({ 
  payments, 
  isLoading,
  activeFilter,
  onFilterChange,
}: PaymentsAnalyticsProps) {
  const analytics = useMemo(() => {
    if (!payments.length) {
      return {
        successful: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        refunded: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        failed: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        fees: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        feesUnknown: 0,
        primaryCurrency: 'BYN',
      };
    }

    const result = {
      successful: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      refunded: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      failed: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      fees: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      feesUnknown: 0,
    };

    const currencyCount: Record<string, number> = {};

    payments.forEach(p => {
      const currency = p.currency || 'BYN';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;

      // F1: Extended failed statuses
      const failedStatuses = ['failed', 'canceled', 'expired', 'declined', 'error'];
      
      if (['successful', 'succeeded'].includes(p.status_normalized)) {
        result.successful[currency] = (result.successful[currency] || 0) + p.amount;
      } else if (failedStatuses.includes(p.status_normalized)) {
        result.failed[currency] = (result.failed[currency] || 0) + p.amount;
      }

      // F2: Refunds from payments_v2.refunded_amount
      if (p.total_refunded > 0) {
        result.refunded[currency] = (result.refunded[currency] || 0) + p.total_refunded;
      }
      
      // F2: Refunds as separate transactions from queue (transaction_type)
      if (p.transaction_type === 'Возврат средств' || p.transaction_type === 'refund') {
        result.refunded[currency] = (result.refunded[currency] || 0) + p.amount;
      }

      // Fees - extract from provider_response if available
      const providerResponse = p.provider_response;
      if (providerResponse?.transaction?.fee) {
        const feeAmount = Number(providerResponse.transaction.fee) / 100; // bePaid returns cents
        result.fees[currency] = (result.fees[currency] || 0) + feeAmount;
      } else if (['successful', 'succeeded'].includes(p.status_normalized)) {
        // Count unknown fees for successful payments
        result.feesUnknown++;
      }
    });

    // Determine primary currency (most common)
    const primaryCurrency = Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'BYN';

    return { ...result, primaryCurrency };
  }, [payments]);

  const handleFilterClick = (filter: AnalyticsFilter) => {
    if (onFilterChange) {
      onFilterChange(activeFilter === filter ? null : filter);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-1 md:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const { primaryCurrency } = analytics;
  const successfulAmount = analytics.successful[primaryCurrency] || 0;
  const refundedAmount = analytics.refunded[primaryCurrency] || 0;
  const feesAmount = analytics.fees[primaryCurrency] || 0;
  const netRevenue = successfulAmount - refundedAmount - feesAmount;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
        <DollarSign className="h-4 w-4" />
        Финансовая сводка за период
        {activeFilter && (
          <span className="text-xs text-primary">• Активен фильтр</span>
        )}
      </h3>
      
      <div className="grid gap-3 grid-cols-1 md:grid-cols-5">
        <AnalyticCard
          title="Успешные платежи"
          amount={successfulAmount}
          currency={primaryCurrency}
          icon={<TrendingUp className="h-5 w-5" />}
          colorClass="text-green-600 dark:text-green-400"
          bgColorClass="bg-green-500/5 dark:bg-green-500/10"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'successful'}
          onClick={() => handleFilterClick('successful')}
          tooltip="Клик для фильтрации по успешным платежам"
        />
        
        <AnalyticCard
          title="Возвраты"
          amount={refundedAmount}
          currency={primaryCurrency}
          icon={<RotateCcw className="h-5 w-5" />}
          colorClass="text-amber-600 dark:text-amber-400"
          bgColorClass="bg-amber-500/5 dark:bg-amber-500/10"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'refunded'}
          onClick={() => handleFilterClick('refunded')}
          tooltip="Клик для фильтрации по возвратам"
        />
        
        <AnalyticCard
          title="Ошибочные"
          amount={analytics.failed[primaryCurrency] || 0}
          currency={primaryCurrency}
          icon={<Ban className="h-5 w-5" />}
          colorClass="text-red-600 dark:text-red-400"
          bgColorClass="bg-red-500/5 dark:bg-red-500/10"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'failed'}
          onClick={() => handleFilterClick('failed')}
          tooltip="Клик для фильтрации по ошибочным платежам"
        />

        <AnalyticCard
          title="Комиссии"
          amount={feesAmount}
          currency={primaryCurrency}
          icon={<Percent className="h-5 w-5" />}
          colorClass="text-purple-600 dark:text-purple-400"
          bgColorClass="bg-purple-500/5 dark:bg-purple-500/10"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'fees'}
          onClick={() => handleFilterClick('fees')}
          tooltip={analytics.feesUnknown > 0 
            ? `Комиссия неизвестна для ${analytics.feesUnknown} платежей` 
            : "Клик для фильтрации по платежам с известной комиссией"}
          subtitle={analytics.feesUnknown > 0 ? `Неизвестно: ${analytics.feesUnknown}` : undefined}
        />

        <AnalyticCard
          title="Чистая выручка"
          amount={netRevenue}
          currency={primaryCurrency}
          icon={<Wallet className="h-5 w-5" />}
          colorClass={netRevenue >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}
          bgColorClass="bg-blue-500/5 dark:bg-blue-500/10"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'net'}
          onClick={() => handleFilterClick('net')}
          tooltip="Успешные минус возвраты и комиссии"
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