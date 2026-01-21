import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { TrendingUp, RotateCcw, Ban, Percent, Wallet, Filter, XCircle } from "lucide-react";
import { UnifiedPayment, DateFilter } from "@/hooks/useUnifiedPayments";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { 
  useBepaidFeeRules, 
  calculateFallbackFee, 
  detectPaymentChannel, 
  extractIssuerCountry 
} from "@/hooks/useBepaidFeeRules";
import { classifyPayment, PaymentCategory } from "@/lib/paymentClassification";

interface ServerStats {
  successful_amount: number;
  successful_count: number;
  refunded_amount: number;
  refunded_count: number;
  cancelled_amount: number;
  cancelled_count: number;
  failed_amount: number;
  failed_count: number;
  pending_amount: number;
  pending_count: number;
  total_count: number;
  net_revenue?: number; // Server-calculated net revenue
}

export type UnifiedDashboardFilter = 'successful' | 'refunded' | 'cancelled' | 'failed' | null;

interface UnifiedPaymentsDashboardProps {
  payments: UnifiedPayment[];
  isLoading: boolean;
  activeFilter?: UnifiedDashboardFilter;
  onFilterChange?: (filter: UnifiedDashboardFilter) => void;
  dateFilter?: DateFilter; // For server-side stats
  includeImport?: boolean; // Toggle to include origin='import' in stats
}

interface DashboardCardProps {
  title: string;
  amount: number | null;
  count: number;
  countLabel: string;
  currency: string;
  icon: React.ReactNode;
  colorClass: string;
  glowColor: string;
  isClickable?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  tooltip?: string;
  showDash?: boolean;
}

function DashboardCard({ 
  title, 
  amount, 
  count,
  countLabel,
  currency, 
  icon, 
  colorClass, 
  glowColor,
  isClickable = false,
  isActive = false,
  onClick,
  tooltip,
  showDash = false,
}: DashboardCardProps) {
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
        "min-h-[140px] p-5",
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
      
      {/* Content - fully centered with consistent structure */}
      <div className="relative flex flex-col items-center justify-between h-full py-2">
        {/* Icon with glow */}
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-xl",
          "bg-gradient-to-br from-white/20 to-white/5",
          "shadow-inner border border-white/10",
          "transition-transform duration-300 group-hover:scale-110"
        )}>
          <div className={cn("transition-all duration-300", colorClass)}>
            {icon}
          </div>
        </div>
        
        {/* Title - fixed height */}
        <span className="text-xs font-medium text-muted-foreground tracking-wide h-4 flex items-center">
          {title}
        </span>
        
        {/* Value block - fixed height for alignment */}
        <div className="flex flex-col items-center h-[52px] justify-center">
          {showDash || amount === null ? (
            <span className="text-xl font-bold text-muted-foreground/50">—</span>
          ) : (
            <>
              <span className={cn("text-xl font-bold tabular-nums tracking-tight", colorClass)}>
                {formatAmount(amount)}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">{currency}</span>
            </>
          )}
        </div>
        
        {/* Count subtitle - fixed height for alignment */}
        <p className="text-[11px] text-muted-foreground/80 text-center leading-tight h-8 flex items-center">
          {count > 0 ? `${count} ${countLabel}` : countLabel}
        </p>
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

export default function UnifiedPaymentsDashboard({ 
  payments, 
  isLoading,
  activeFilter,
  onFilterChange,
  dateFilter,
  includeImport = false,
}: UnifiedPaymentsDashboardProps) {
  // Fetch fee rules from integration settings
  const { data: feeRules, isLoading: isLoadingRules } = useBepaidFeeRules();
  
  // Fetch accurate server-side statistics
  // Use explicit primitives in queryKey for stable caching
  const effectiveIncludeImport = (dateFilter as any)?.includeImport ?? includeImport;
  
  const { data: serverStats, isLoading: isLoadingStats, isFetching: isFetchingStats } = useQuery({
    queryKey: ["payment-stats", dateFilter?.from || null, dateFilter?.to || null, effectiveIncludeImport],
    queryFn: async () => {
      if (!dateFilter?.from || !dateFilter?.to) return null;
      
      console.log(`[Dashboard Stats] Fetching: ${dateFilter.from} to ${dateFilter.to}, includeImport=${effectiveIncludeImport}`);
      
      const { data, error } = await supabase.rpc('get_payments_stats', {
        from_date: dateFilter.from,
        to_date: dateFilter.to,
        include_import: effectiveIncludeImport,
      });
      
      if (error) {
        console.error('Error fetching server stats:', error);
        return null;
      }
      
      console.log(`[Dashboard Stats] Result:`, data);
      return data as unknown as ServerStats | null;
    },
    enabled: !!dateFilter?.from && !!dateFilter?.to,
    staleTime: 0,
    refetchOnMount: 'always',
    gcTime: 0,
  });
  
  const analytics = useMemo(() => {
    if (!payments.length || !feeRules) {
      return {
        successful: { amount: 0, count: 0 },
        refunded: { amount: 0, count: 0 },
        cancelled: { amount: 0, count: 0 },
        failed: { amount: 0, count: 0 },
        fees: { amount: 0, count: 0 },
        feesUnknown: 0,
        feesKnown: 0,
        feesFallback: 0,
        primaryCurrency: 'BYN',
        netRevenue: 0,
      };
    }

    const result = {
      successful: { BYN: 0, count: 0 } as { [key: string]: number; count: number },
      refunded: { BYN: 0, count: 0 } as { [key: string]: number; count: number },
      cancelled: { BYN: 0, count: 0 } as { [key: string]: number; count: number },
      failed: { BYN: 0, count: 0 } as { [key: string]: number; count: number },
      fees: { BYN: 0 } as Record<string, number>,
      feesUnknown: 0,
      feesKnown: 0,
      feesFallback: 0,
    };

    const currencyCount: Record<string, number> = {};
    const processedRefundUids = new Set<string>();

    // Use centralized classifyPayment for EXACT match with RPC logic
    payments.forEach(p => {
      const currency = p.currency || 'BYN';
      currencyCount[currency] = (currencyCount[currency] || 0) + 1;

      // Single source of truth: classifyPayment
      const category = classifyPayment(
        p.status_normalized,
        p.transaction_type,
        p.amount
      );
      
      switch (category) {
        case 'successful': {
          result.successful[currency] = (result.successful[currency] || 0) + p.amount;
          result.successful.count++;
          
          // Fee calculation for successful payments
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
              feeAmount = Number(fee) / 100;
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
          break;
        }
        
        case 'refunded': {
          // Handle refunds - use ABS to ensure positive
          if (!processedRefundUids.has(p.uid || '')) {
            result.refunded[currency] = (result.refunded[currency] || 0) + Math.abs(p.amount);
            result.refunded.count++;
            if (p.uid) {
              processedRefundUids.add(p.uid);
            }
          }
          // Also count total_refunded from parent payment if available
          if (p.total_refunded > 0 && !processedRefundUids.has(`${p.uid}_total`)) {
            result.refunded[currency] = (result.refunded[currency] || 0) + p.total_refunded;
            if (p.uid) {
              processedRefundUids.add(`${p.uid}_total`);
            }
          }
          break;
        }
        
        case 'cancelled': {
          result.cancelled[currency] = (result.cancelled[currency] || 0) + Math.abs(p.amount);
          result.cancelled.count++;
          break;
        }
        
        case 'failed': {
          result.failed[currency] = (result.failed[currency] || 0) + Math.abs(p.amount);
          result.failed.count++;
          break;
        }
        
        // pending and unknown are not displayed in dashboard cards
        default:
          break;
      }
    });

    const primaryCurrency = Object.entries(currencyCount)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'BYN';

    const successfulAmount = result.successful[primaryCurrency] || 0;
    const refundedAmount = result.refunded[primaryCurrency] || 0;
    const feesAmount = result.fees[primaryCurrency] || 0;
    const netRevenue = successfulAmount - refundedAmount - feesAmount;

    // Use server stats for accurate counts if available (amounts stored in BYN, not kopecks)
    const finalSuccessfulAmount = serverStats?.successful_amount != null 
      ? serverStats.successful_amount
      : successfulAmount;
    const finalSuccessfulCount = serverStats?.successful_count ?? result.successful.count;
    
    const finalRefundedAmount = serverStats?.refunded_amount != null
      ? serverStats.refunded_amount
      : refundedAmount;
    const finalRefundedCount = serverStats?.refunded_count ?? result.refunded.count;
    
    const finalFailedAmount = serverStats?.failed_amount != null
      ? serverStats.failed_amount
      : (result.failed[primaryCurrency] || 0);
    const finalFailedCount = serverStats?.failed_count ?? result.failed.count;
    
    // Get cancelled stats from server or client fallback
    const finalCancelledAmount = serverStats?.cancelled_amount != null
      ? Math.abs(serverStats.cancelled_amount)
      : (result.cancelled[primaryCurrency] || 0);
    const finalCancelledCount = serverStats?.cancelled_count ?? result.cancelled.count;
    
    // Net revenue: prefer server-calculated, fallback to client calculation
    // Server formula: Successful - Refunds - Cancellations (fees client-side)
    const serverNetRevenue = serverStats?.net_revenue;
    const finalNetRevenue = serverNetRevenue != null 
      ? serverNetRevenue - feesAmount  // Server includes S-R-C, we subtract fees
      : finalSuccessfulAmount - finalRefundedAmount - finalCancelledAmount - feesAmount;

    return { 
      successful: { amount: finalSuccessfulAmount, count: finalSuccessfulCount },
      refunded: { amount: finalRefundedAmount, count: finalRefundedCount },
      cancelled: { amount: finalCancelledAmount, count: finalCancelledCount },
      failed: { amount: finalFailedAmount, count: finalFailedCount },
      fees: { amount: feesAmount, count: result.feesKnown + result.feesFallback },
      feesUnknown: result.feesUnknown,
      feesKnown: result.feesKnown,
      feesFallback: result.feesFallback,
      primaryCurrency,
      netRevenue: finalNetRevenue,
    };
  }, [payments, feeRules, serverStats]);

  const handleFilterClick = (filter: UnifiedDashboardFilter) => {
    if (onFilterChange) {
      onFilterChange(activeFilter === filter ? null : filter);
    }
  };

  if (isLoading || isLoadingRules || isLoadingStats) {
    return (
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-2xl p-5 backdrop-blur-2xl bg-card/60 border border-border/30 min-h-[140px] flex flex-col items-center justify-center gap-2">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    );
  }

  const { primaryCurrency } = analytics;
  const showFeesAsDash = analytics.feesKnown === 0 && analytics.feesFallback === 0;

  // Pluralize helper for Russian
  const pluralize = (count: number, one: string, few: string, many: string) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          Финансовая сводка
          {/* Dataset indicator badge */}
          <span className={cn(
            "ml-2 text-[10px] font-normal px-2 py-0.5 rounded-full",
            effectiveIncludeImport 
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" 
              : "bg-muted text-muted-foreground"
          )}>
            {effectiveIncludeImport ? "bePaid + импорт" : "только bePaid"}
          </span>
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
      
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <DashboardCard
          title="Успешные"
          amount={analytics.successful.amount}
          count={analytics.successful.count}
          countLabel={pluralize(analytics.successful.count, 'транзакция', 'транзакции', 'транзакций')}
          currency={primaryCurrency}
          icon={<TrendingUp className="h-5 w-5" />}
          colorClass="text-emerald-500"
          glowColor="bg-emerald-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'successful'}
          onClick={() => handleFilterClick('successful')}
          tooltip="Клик для фильтрации по успешным платежам"
        />
        
        <DashboardCard
          title="Возвраты"
          amount={analytics.refunded.amount}
          count={analytics.refunded.count}
          countLabel={pluralize(analytics.refunded.count, 'возврат', 'возврата', 'возвратов')}
          currency={primaryCurrency}
          icon={<RotateCcw className="h-5 w-5" />}
          colorClass="text-amber-500"
          glowColor="bg-amber-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'refunded'}
          onClick={() => handleFilterClick('refunded')}
          tooltip="Клик для фильтрации по возвратам"
        />
        
        <DashboardCard
          title="Отмены"
          amount={analytics.cancelled.amount}
          count={analytics.cancelled.count}
          countLabel={pluralize(analytics.cancelled.count, 'отмена', 'отмены', 'отмен')}
          currency={primaryCurrency}
          icon={<XCircle className="h-5 w-5" />}
          colorClass="text-orange-500"
          glowColor="bg-orange-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'cancelled'}
          onClick={() => handleFilterClick('cancelled')}
          tooltip="Клик для фильтрации по отменённым платежам"
        />
        
        <DashboardCard
          title="Ошибочные"
          amount={analytics.failed.amount}
          count={analytics.failed.count}
          countLabel={pluralize(analytics.failed.count, 'ошибка', 'ошибки', 'ошибок')}
          currency={primaryCurrency}
          icon={<Ban className="h-5 w-5" />}
          colorClass="text-rose-500"
          glowColor="bg-rose-500"
          isClickable={!!onFilterChange}
          isActive={activeFilter === 'failed'}
          onClick={() => handleFilterClick('failed')}
          tooltip="Клик для фильтрации по ошибочным платежам"
        />

        <DashboardCard
          title="Комиссии"
          amount={showFeesAsDash ? null : analytics.fees.amount}
          count={analytics.fees.count}
          countLabel={analytics.feesFallback > 0 ? `расчёт: ${analytics.feesFallback}` : 'не фильтруется'}
          currency={primaryCurrency}
          icon={<Percent className="h-5 w-5" />}
          colorClass="text-violet-500"
          glowColor="bg-violet-500"
          isClickable={false}
          isActive={false}
          tooltip={`Из API: ${analytics.feesKnown} · Расчётные: ${analytics.feesFallback} · Неизвестно: ${analytics.feesUnknown}. Эта карточка не является фильтром.`}
          showDash={showFeesAsDash}
        />

        <DashboardCard
          title="Чистая выручка"
          amount={analytics.netRevenue}
          count={0}
          countLabel="не фильтруется"
          currency={primaryCurrency}
          icon={<Wallet className="h-5 w-5" />}
          colorClass={analytics.netRevenue >= 0 ? "text-sky-500" : "text-rose-500"}
          glowColor={analytics.netRevenue >= 0 ? "bg-sky-500" : "bg-rose-500"}
          isClickable={false}
          isActive={false}
          tooltip={`Формула: Gross − Возвраты − Отмены − Комиссии = ${analytics.netRevenue.toFixed(2)} ${primaryCurrency}. Эта карточка не является фильтром.`}
        />
      </div>
    </div>
  );
}
