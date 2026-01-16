import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, DollarSign, RotateCcw, Ban, Percent, Wallet, Filter } from "lucide-react";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  useBepaidFeeRules, 
  calculateFallbackFee, 
  detectPaymentChannel, 
  extractIssuerCountry 
} from "@/hooks/useBepaidFeeRules";
export type AnalyticsFilter = 'successful' | 'refunded' | 'failed' | 'fees' | 'net' | null;

// Constants for status classification
export const FAILED_STATUSES = ['failed', 'canceled', 'cancelled', 'expired', 'declined', 'error', 'voided'];
export const SUCCESSFUL_STATUSES = ['successful', 'succeeded'];

interface PaymentsAnalyticsProps {
  payments: UnifiedPayment[];  // Full unfiltered payments for correct totals
  isLoading: boolean;
  activeFilter?: AnalyticsFilter;
  onFilterChange?: (filter: AnalyticsFilter) => void;
}

interface AnalyticCardProps {
  title: string;
  amount: number | null;
  currency: string;
  icon: React.ReactNode;
  colorClass: string;
  glowColor: string;
  isClickable?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  tooltip?: string;
  subtitle?: string;
  showDash?: boolean;
}

function AnalyticCard({ 
  title, 
  amount, 
  currency, 
  icon, 
  colorClass, 
  glowColor,
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
        "relative overflow-hidden rounded-2xl transition-all duration-300 ease-out",
        "backdrop-blur-2xl bg-gradient-to-br from-card/80 via-card/60 to-card/40",
        "border border-border/30 hover:border-border/60",
        "shadow-lg hover:shadow-xl",
        "h-[160px] p-5", // Fixed height for equal card sizes
        "group",
        isClickable && "cursor-pointer hover:scale-[1.02] active:scale-[0.98]",
        !isClickable && "opacity-90",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.01]"
      )}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Glassmorphism layers */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent pointer-events-none" />
      
      {/* Colored glow effect */}
      <div className={cn(
        "absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl transition-all duration-300",
        "opacity-20 group-hover:opacity-40",
        glowColor
      )} />
      
      {/* Active filter indicator */}
      {isActive && (
        <div className="absolute top-3 right-3">
          <Filter className="h-3.5 w-3.5 text-primary animate-pulse" />
        </div>
      )}
      
      {/* Content - fully centered */}
      <div className="relative flex-1 flex flex-col items-center justify-center gap-2 h-full">
        {/* Icon with glow */}
        <div className={cn(
          "flex items-center justify-center w-11 h-11 rounded-xl",
          "bg-gradient-to-br from-white/20 to-white/5",
          "shadow-inner border border-white/10",
          "transition-transform duration-300 group-hover:scale-110"
        )}>
          <div className={cn("transition-all duration-300", colorClass)}>
            {icon}
          </div>
        </div>
        
        {/* Title */}
        <span className="text-xs font-medium text-muted-foreground tracking-wide">
          {title}
        </span>
        
        {/* Value */}
        <div className="flex flex-col items-center">
          {showDash || amount === null ? (
            <span className="text-2xl font-bold text-muted-foreground/50">—</span>
          ) : (
            <>
              <span className={cn("text-2xl font-bold tabular-nums tracking-tight", colorClass)}>
                {formatAmount(amount)}
              </span>
              <span className="text-xs font-medium text-muted-foreground mt-0.5">{currency}</span>
            </>
          )}
        </div>
        
        {/* Subtitle */}
        {subtitle && (
          <p className="text-[11px] text-muted-foreground/80 text-center leading-tight">
            {subtitle}
          </p>
        )}
      </div>
      
      {/* Active indicator */}
      {isActive && (
        <div className={cn("absolute bottom-0 left-0 right-0 h-1 rounded-b-2xl", glowColor)} />
      )}
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{content}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
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
  // Fetch fee rules from integration settings
  const { data: feeRules, isLoading: isLoadingRules } = useBepaidFeeRules();
  
  const analytics = useMemo(() => {
    if (!payments.length || !feeRules) {
      return {
        successful: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        refunded: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        failed: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        fees: { BYN: 0, USD: 0, EUR: 0, RUB: 0 },
        feesUnknown: 0,
        feesKnown: 0,
        feesFallback: 0,
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
      feesFallback: 0,
    };

    const currencyCount: Record<string, number> = {};
    const processedRefundUids = new Set<string>();

    payments.forEach(p => {
      const currency = p.currency || 'BYN';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;

      const statusNormalized = (p.status_normalized || '').toLowerCase();
      
      // Check if this is a refund transaction (negative amount or refund type)
      const txType = (p.transaction_type || '').toLowerCase();
      const isRefundTx = p.amount < 0 
        || txType === 'возврат средств' 
        || txType === 'refund'
        || txType.includes('возврат')
        || statusNormalized === 'refunded';
      
      // Only count successful if it's NOT a refund
      if (SUCCESSFUL_STATUSES.includes(statusNormalized) && !isRefundTx && p.amount > 0) {
        result.successful[currency] = (result.successful[currency] || 0) + p.amount;
        
        // Try to extract fee from provider response
        let feeAmount: number | null = null;
        let feeSource: 'provider' | 'fallback' | null = null;
        const providerResponse = p.provider_response;
        
        if (providerResponse) {
          const fee = providerResponse.transaction?.fee 
            ?? providerResponse.transaction?.processing?.fee
            ?? providerResponse.transaction?.payment?.fee
            ?? providerResponse.fee
            ?? null;
          
          if (fee !== null && fee !== undefined && Number(fee) > 0) {
            feeAmount = Number(fee) / 100; // Convert from cents
            feeSource = 'provider';
          }
        }
        
        // Fallback to provider_fee_amount column
        if (feeAmount === null && (p as any).provider_fee_amount != null && (p as any).provider_fee_amount > 0) {
          feeAmount = (p as any).provider_fee_amount;
          feeSource = 'provider';
        }
        
        // Apply fallback calculation if no provider fee found
        if (feeAmount === null || feeAmount <= 0) {
          const channel = detectPaymentChannel(
            (p as any).payment_method,
            p.transaction_type,
            providerResponse
          );
          const issuerCountry = extractIssuerCountry(providerResponse);
          
          const fallbackResult = calculateFallbackFee(
            p.amount,
            currency,
            channel,
            issuerCountry,
            feeRules
          );
          
          feeAmount = fallbackResult.fee;
          feeSource = 'fallback';
        }
        
        // Add fee to totals
        if (feeAmount !== null && !isNaN(feeAmount) && feeAmount > 0) {
          result.fees[currency] = (result.fees[currency] || 0) + feeAmount;
          
          if (feeSource === 'provider') {
            result.feesKnown++;
          } else if (feeSource === 'fallback') {
            result.feesFallback++;
          }
        } else {
          result.feesUnknown++;
        }
      }

      if (FAILED_STATUSES.includes(statusNormalized)) {
        result.failed[currency] = (result.failed[currency] || 0) + Math.abs(p.amount);
      }

      // Handle refunds from payments_v2 via total_refunded field (linked to parent payment)
      if (p.rawSource === 'payments_v2' && p.total_refunded > 0) {
        result.refunded[currency] = (result.refunded[currency] || 0) + p.total_refunded;
        if (p.uid) {
          processedRefundUids.add(p.uid);
        }
      }
      
      // Handle standalone refund records (from payments_v2 with status=refunded and negative amount)
      if (p.rawSource === 'payments_v2' && statusNormalized === 'refunded' && p.amount < 0) {
        const shouldSkip = p.uid && processedRefundUids.has(p.uid);
        if (!shouldSkip) {
          result.refunded[currency] = (result.refunded[currency] || 0) + Math.abs(p.amount);
          if (p.uid) {
            processedRefundUids.add(p.uid);
          }
        }
      }
      
      // Handle refunds from queue (now with negative amounts after transformation)
      if (p.rawSource === 'queue' && isRefundTx) {
        const shouldSkip = p.uid && processedRefundUids.has(p.uid);
        if (!shouldSkip) {
          // Use absolute value since amount is now negative for refunds
          result.refunded[currency] = (result.refunded[currency] || 0) + Math.abs(p.amount);
          if (p.uid) {
            processedRefundUids.add(p.uid);
          }
        }
      }
    });

    const primaryCurrency = Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'BYN';

    return { ...result, primaryCurrency };
  }, [payments, feeRules]);

  const handleFilterClick = (filter: AnalyticsFilter) => {
    if (onFilterChange) {
      onFilterChange(activeFilter === filter ? null : filter);
    }
  };

  if (isLoading || isLoadingRules) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-48 bg-muted/30 animate-pulse rounded" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-2xl p-5 backdrop-blur-2xl bg-card/60 border border-border/30 h-[160px] flex flex-col items-center justify-center gap-2">
              <div className="h-11 w-11 rounded-xl bg-muted/30 animate-pulse" />
              <div className="h-3 w-16 bg-muted/30 animate-pulse rounded" />
              <div className="h-7 w-20 bg-muted/30 animate-pulse rounded" />
              <div className="h-3 w-8 bg-muted/30 animate-pulse rounded" />
            </div>
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
  const showFeesAsDash = analytics.feesKnown === 0 && analytics.feesFallback === 0;
  
  // Build tooltip for fees card
  const feesTooltip = (() => {
    const parts: string[] = [];
    if (analytics.feesKnown > 0) {
      parts.push(`Из API: ${analytics.feesKnown}`);
    }
    if (analytics.feesFallback > 0) {
      parts.push(`Расчётные: ${analytics.feesFallback}`);
    }
    if (analytics.feesUnknown > 0) {
      parts.push(`Неизвестно: ${analytics.feesUnknown}`);
    }
    return parts.length > 0 ? parts.join(' · ') : "Клик для фильтрации по платежам с комиссией";
  })();
  
  // Build subtitle for fees card
  const feesSubtitle = (() => {
    if (analytics.feesFallback > 0 && analytics.feesUnknown === 0) {
      return `Расчётные: ${analytics.feesFallback}`;
    }
    if (analytics.feesUnknown > 0) {
      return `Неизвестно: ${analytics.feesUnknown}`;
    }
    return undefined;
  })();


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
          colorClass="text-emerald-500"
          glowColor="bg-emerald-500"
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
          colorClass="text-amber-500"
          glowColor="bg-amber-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'refunded'}
          onClick={() => handleFilterClick('refunded')}
          tooltip="Клик для фильтрации по возвратам"
        />
        
        <AnalyticCard
          title="Ошибочные"
          amount={failedAmount}
          currency={primaryCurrency}
          icon={<Ban className="h-5 w-5" />}
          colorClass="text-rose-500"
          glowColor="bg-rose-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'failed'}
          onClick={() => handleFilterClick('failed')}
          tooltip="Клик для фильтрации по ошибочным платежам"
        />

        <AnalyticCard
          title="Комиссии"
          amount={showFeesAsDash ? null : feesAmount}
          currency={primaryCurrency}
          icon={<Percent className="h-5 w-5" />}
          colorClass="text-violet-500"
          glowColor="bg-violet-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'fees'}
          onClick={() => handleFilterClick('fees')}
          tooltip={feesTooltip}
          subtitle={feesSubtitle}
          showDash={showFeesAsDash}
        />

        <AnalyticCard
          title="Чистая выручка"
          amount={netRevenue}
          currency={primaryCurrency}
          icon={<Wallet className="h-5 w-5" />}
          colorClass={netRevenue >= 0 ? "text-sky-500" : "text-rose-500"}
          glowColor={netRevenue >= 0 ? "bg-sky-500" : "bg-rose-500"}
          isClickable={false}
          isActive={false}
          tooltip="Gross − Возвраты − Комиссии"
        />
      </div>
      
      {Object.keys(analytics.successful).filter(c => c !== primaryCurrency && analytics.successful[c] > 0).length > 0 && (
        <div className="text-xs text-muted-foreground bg-muted/30 backdrop-blur-sm px-3 py-2 rounded-lg border border-border/20">
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
