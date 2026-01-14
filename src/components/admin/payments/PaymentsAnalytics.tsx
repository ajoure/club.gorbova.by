import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, DollarSign, RotateCcw, Ban, Percent, Wallet, Filter } from "lucide-react";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type AnalyticsFilter = 'successful' | 'refunded' | 'failed' | 'fees' | 'net' | null;

// Constants for status classification
export const FAILED_STATUSES = ['failed', 'canceled', 'expired', 'declined', 'error'];
export const SUCCESSFUL_STATUSES = ['successful', 'succeeded'];

interface PaymentsAnalyticsProps {
  payments: UnifiedPayment[];
  isLoading: boolean;
  activeFilter?: AnalyticsFilter;
  onFilterChange?: (filter: AnalyticsFilter) => void;
}

interface AnalyticCardProps {
  title: string;
  amount: number | null; // null means unknown/no data
  currency: string;
  icon: React.ReactNode;
  colorClass: string;
  bgColorClass: string;
  borderColorClass: string;
  isClickable?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  tooltip?: string;
  subtitle?: string;
  showDash?: boolean; // Show "—" instead of amount when true
}

function AnalyticCard({ 
  title, 
  amount, 
  currency, 
  icon, 
  colorClass, 
  bgColorClass,
  borderColorClass,
  isClickable = false,
  isActive = false,
  onClick,
  tooltip,
  subtitle,
  showDash = false,
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
        "relative overflow-hidden rounded-xl border-2 transition-all duration-200",
        "min-h-[100px] p-4",
        bgColorClass,
        isClickable && "cursor-pointer",
        isClickable && "hover:shadow-lg hover:scale-[1.02] hover:-translate-y-0.5",
        isActive ? cn("ring-2 ring-offset-2 ring-offset-background shadow-lg", borderColorClass, "ring-current") : "border-border/40",
        isActive && borderColorClass
      )}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Active filter indicator */}
      {isActive && (
        <div className="absolute top-2 right-2">
          <Filter className="h-3.5 w-3.5 text-primary animate-pulse" />
        </div>
      )}
      
      <div className="flex items-start gap-3">
        <div className={cn(
          "flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0",
          "bg-background/90 shadow-sm border border-border/20",
          colorClass
        )}>
          {icon}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
            {title}
          </p>
          <div className="flex items-baseline gap-2">
            {showDash || amount === null ? (
              <span className="text-2xl font-bold text-muted-foreground/50">—</span>
            ) : (
              <>
                <span className={cn("text-2xl font-bold tabular-nums tracking-tight", colorClass)}>
                  {formatAmount(amount)}
                </span>
                <span className="text-sm font-medium text-muted-foreground">{currency}</span>
              </>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground/80 font-medium">{subtitle}</p>
          )}
        </div>
      </div>
      
      {/* Clickable hint */}
      {isClickable && !isActive && (
        <div className="absolute bottom-1.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-muted-foreground">Клик для фильтра</span>
        </div>
      )}
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="group">{content}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return <div className="group">{content}</div>;
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
        feesKnown: 0,
        primaryCurrency: 'BYN',
      };
    }

    const result = {
      successful: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      refunded: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      failed: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      fees: { BYN: 0, USD: 0, EUR: 0, RUB: 0 } as Record<string, number>,
      feesUnknown: 0,
      feesKnown: 0,
    };

    const currencyCount: Record<string, number> = {};
    
    // Track UIDs from payments_v2 that have refunded_amount to avoid double-counting
    const processedRefundUids = new Set<string>();

    payments.forEach(p => {
      const currency = p.currency || 'BYN';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;

      const statusNormalized = (p.status_normalized || '').toLowerCase();
      
      // Successful payments (Gross)
      if (SUCCESSFUL_STATUSES.includes(statusNormalized)) {
        result.successful[currency] = (result.successful[currency] || 0) + p.amount;
        
        // Fees extraction - multiple fallback paths
        let feeAmount: number | null = null;
        const providerResponse = p.provider_response;
        
        if (providerResponse) {
          // Try multiple paths for fee
          const fee = providerResponse.transaction?.fee 
            ?? providerResponse.transaction?.processing?.fee
            ?? providerResponse.transaction?.payment?.fee
            ?? providerResponse.fee
            ?? null;
          
          if (fee !== null && fee !== undefined) {
            // bePaid returns fee in cents
            feeAmount = Number(fee) / 100;
          }
        }
        
        // Also check unified payment fee fields (if added)
        if (feeAmount === null && (p as any).provider_fee_amount != null) {
          feeAmount = (p as any).provider_fee_amount;
        }
        
        if (feeAmount !== null && !isNaN(feeAmount) && feeAmount > 0) {
          result.fees[currency] = (result.fees[currency] || 0) + feeAmount;
          result.feesKnown++;
        } else {
          result.feesUnknown++;
        }
      }

      // Failed payments
      if (FAILED_STATUSES.includes(statusNormalized)) {
        result.failed[currency] = (result.failed[currency] || 0) + p.amount;
      }

      // Refunds - with proper dedup logic
      // Priority 1: payments_v2.total_refunded (refunded_amount)
      if (p.rawSource === 'payments_v2' && p.total_refunded > 0) {
        result.refunded[currency] = (result.refunded[currency] || 0) + p.total_refunded;
        // Mark this UID as having refund accounted for (uid = provider_payment_id for payments_v2)
        if (p.uid) {
          processedRefundUids.add(p.uid);
        }
      }
      
      // Priority 2: Separate refund transactions from queue
      // Only count if NOT already accounted for in payments_v2
      if (p.rawSource === 'queue') {
        const isRefundTx = p.transaction_type === 'Возврат средств' 
          || p.transaction_type === 'refund'
          || statusNormalized === 'refunded';
        
        if (isRefundTx) {
          // Check by bepaid_uid - if a payment_v2 record has this as provider_payment_id, skip
          const shouldSkip = p.uid && processedRefundUids.has(p.uid);
          if (!shouldSkip) {
            result.refunded[currency] = (result.refunded[currency] || 0) + p.amount;
          }
        }
      }
    });

    // Determine primary currency (most common)
    const primaryCurrency = Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'BYN';

    return { ...result, primaryCurrency };
  }, [payments]);

  const handleFilterClick = (filter: AnalyticsFilter) => {
    if (onFilterChange) {
      // Toggle off if already active
      onFilterChange(activeFilter === filter ? null : filter);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-48 bg-muted/30 animate-pulse rounded" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[100px] rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { primaryCurrency } = analytics;
  const successfulAmount = analytics.successful[primaryCurrency] || 0;
  const refundedAmount = analytics.refunded[primaryCurrency] || 0;
  const failedAmount = analytics.failed[primaryCurrency] || 0;
  const feesAmount = analytics.fees[primaryCurrency] || 0;
  const netRevenue = successfulAmount - refundedAmount - feesAmount;
  
  // Only show fees amount if we have known fees, otherwise show dash
  const showFeesAsDash = analytics.feesKnown === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          Финансовая сводка за период
        </h3>
        {activeFilter && (
          <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 px-2.5 py-1 rounded-full animate-in fade-in">
            <Filter className="h-3 w-3" />
            <span>Активен фильтр</span>
            <button 
              onClick={() => onFilterChange?.(null)}
              className="ml-1 hover:text-primary/70 underline"
            >
              сбросить
            </button>
          </div>
        )}
      </div>
      
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <AnalyticCard
          title="Успешные"
          amount={successfulAmount}
          currency={primaryCurrency}
          icon={<TrendingUp className="h-5 w-5" />}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgColorClass="bg-emerald-50/50 dark:bg-emerald-950/20"
          borderColorClass="border-emerald-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'successful'}
          onClick={() => handleFilterClick('successful')}
          tooltip="Клик для фильтрации по успешным платежам. Повторный клик сбросит фильтр."
        />
        
        <AnalyticCard
          title="Возвраты"
          amount={refundedAmount}
          currency={primaryCurrency}
          icon={<RotateCcw className="h-5 w-5" />}
          colorClass="text-amber-600 dark:text-amber-400"
          bgColorClass="bg-amber-50/50 dark:bg-amber-950/20"
          borderColorClass="border-amber-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'refunded'}
          onClick={() => handleFilterClick('refunded')}
          tooltip="Клик для фильтрации по возвратам. Повторный клик сбросит фильтр."
        />
        
        <AnalyticCard
          title="Ошибочные"
          amount={failedAmount}
          currency={primaryCurrency}
          icon={<Ban className="h-5 w-5" />}
          colorClass="text-rose-600 dark:text-rose-400"
          bgColorClass="bg-rose-50/50 dark:bg-rose-950/20"
          borderColorClass="border-rose-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'failed'}
          onClick={() => handleFilterClick('failed')}
          tooltip="Клик для фильтрации по ошибочным платежам. Повторный клик сбросит фильтр."
        />

        <AnalyticCard
          title="Комиссии"
          amount={showFeesAsDash ? null : feesAmount}
          currency={primaryCurrency}
          icon={<Percent className="h-5 w-5" />}
          colorClass="text-violet-600 dark:text-violet-400"
          bgColorClass="bg-violet-50/50 dark:bg-violet-950/20"
          borderColorClass="border-violet-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'fees'}
          onClick={() => handleFilterClick('fees')}
          tooltip={analytics.feesUnknown > 0 
            ? `Комиссия известна для ${analytics.feesKnown} платежей. Используйте "Получить чеки" для загрузки комиссий.` 
            : "Клик для фильтрации по платежам с известной комиссией."}
          subtitle={analytics.feesUnknown > 0 ? `Неизвестно: ${analytics.feesUnknown}` : undefined}
          showDash={showFeesAsDash}
        />

        <AnalyticCard
          title="Чистая выручка"
          amount={netRevenue}
          currency={primaryCurrency}
          icon={<Wallet className="h-5 w-5" />}
          colorClass={netRevenue >= 0 ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"}
          bgColorClass="bg-sky-50/50 dark:bg-sky-950/20"
          borderColorClass="border-sky-500"
          isClickable={false}
          isActive={false}
          onClick={() => {}}
          tooltip="Gross − Возвраты − Комиссии. Эта карточка не кликабельна."
        />
      </div>
      
      {/* Show other currencies if present */}
      {Object.keys(analytics.successful).filter(c => c !== primaryCurrency && analytics.successful[c] > 0).length > 0 && (
        <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-lg">
          <span className="font-medium">Другие валюты: </span>
          {Object.entries(analytics.successful)
            .filter(([c, v]) => c !== primaryCurrency && v > 0)
            .map(([currency, amount]) => (
              <span key={currency} className="mr-3 font-mono">
                +{amount.toFixed(2)} {currency}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
