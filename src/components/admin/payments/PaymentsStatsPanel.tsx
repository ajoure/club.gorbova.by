import { useMemo } from "react";
import { CheckCircle2, XCircle, RotateCcw, Percent, TrendingUp, Loader2 } from "lucide-react";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { classifyPayment } from "@/lib/paymentClassification";
import { cn } from "@/lib/utils";

// Payment filter types
export type StatsFilterType = 'successful' | 'refunded' | 'cancelled' | 'failed' | null;

interface PaymentsStatsPanelProps {
  payments: UnifiedPayment[];
  isLoading?: boolean;
  dateRange?: { from: string; to?: string | null };
  activeFilter?: StatsFilterType;
  onFilterChange?: (filter: StatsFilterType) => void;
}

interface StatCardProps {
  title: string;
  amount: number;
  count: number;
  icon: React.ReactNode;
  colorClass: string;
  accentGradient: string;
  currency?: string;
  subtitle?: string;
  filterKey?: StatsFilterType;
  isActive?: boolean;
  isClickable?: boolean;
  onClick?: () => void;
}

// Glassmorphism stat card with clickable filter support
function StatCard({ 
  title, 
  amount, 
  count, 
  icon, 
  colorClass, 
  accentGradient, 
  currency = "BYN", 
  subtitle,
  isActive = false,
  isClickable = true,
  onClick 
}: StatCardProps) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "group relative rounded-xl p-3 md:p-4",
        // Glassmorphism: transparent, backdrop-blur
        "bg-gradient-to-br from-white/5 to-white/[0.02]",
        "dark:from-slate-500/10 dark:to-slate-600/5",
        "backdrop-blur-xl",
        "border border-white/10 dark:border-slate-500/20",
        "shadow-lg shadow-black/5",
        "overflow-hidden",
        "transition-all duration-300",
        // Hover effects
        isClickable && "cursor-pointer hover:scale-[1.02] hover:border-white/20 dark:hover:border-slate-400/30",
        // Active state
        isActive && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        isActive && "border-primary/50"
      )}
    >
      {/* Gradient accent line top with glow */}
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accentGradient} opacity-60`} />
      <div className={`absolute inset-x-4 top-0 h-px bg-gradient-to-r ${accentGradient} blur-sm opacity-40`} />
      
      {/* Inner shine overlay */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/[0.03] via-transparent to-transparent pointer-events-none" />
      
      {/* Header: icon + title */}
      <div className="relative z-10 flex items-center gap-2 mb-2.5">
        <div className="shrink-0 opacity-90">{icon}</div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
      </div>
      
      {/* Amount - main value */}
      <div className={cn(
        "relative z-10 text-lg md:text-xl font-bold tabular-nums",
        colorClass,
        "flex items-baseline gap-1.5 flex-wrap tracking-tight"
      )}>
        <span className="drop-shadow-sm">
          {amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className="text-xs text-muted-foreground font-medium">{currency}</span>
      </div>
      
      {/* Count and subtitle */}
      <div className="relative z-10 flex items-center gap-2 text-xs text-muted-foreground mt-2">
        <span className="tabular-nums">{count.toLocaleString('ru-RU')} шт</span>
        {subtitle && (
          <>
            <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
            <span>{subtitle}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentsStatsPanel({ 
  payments, 
  isLoading, 
  dateRange,
  activeFilter,
  onFilterChange 
}: PaymentsStatsPanelProps) {
  const stats = useMemo(() => {
    if (!payments || payments.length === 0) {
      return {
        successful: { count: 0, amount: 0 },
        refunded: { count: 0, amount: 0 },
        failed: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
        fees: { amount: 0, percent: 0 },
        netRevenue: 0,
      };
    }

    let successfulCount = 0;
    let successfulAmount = 0;
    let refundedCount = 0;
    let refundedAmount = 0;
    let failedCount = 0;
    let failedAmount = 0;
    let cancelledCount = 0;
    let cancelledAmount = 0;
    let totalFees = 0;

    for (const p of payments) {
      const category = classifyPayment(p.status_normalized, p.transaction_type, p.amount);
      const absAmount = Math.abs(p.amount || 0);
      // Extract real commission from meta (synced from bePaid statement)
      const realFee = (p as any).commission_total || 0;
      
      switch (category) {
        case 'successful':
          successfulCount++;
          successfulAmount += absAmount;
          totalFees += realFee;
          break;
        case 'refunded':
          refundedCount++;
          refundedAmount += absAmount;
          break;
        case 'failed':
          failedCount++;
          failedAmount += absAmount;
          break;
        case 'cancelled':
          cancelledCount++;
          cancelledAmount += absAmount;
          break;
      }
    }

    // Use real fees from bePaid statement (no fallback to estimated %)
    const estimatedFees = totalFees;
    
    const feePercent = successfulAmount > 0 
      ? (estimatedFees / successfulAmount) * 100 
      : 0;

    // Чистая выручка = Успешные - Возвраты - Комиссия
    const netRevenue = successfulAmount - refundedAmount - estimatedFees;

    return {
      successful: { count: successfulCount, amount: successfulAmount },
      refunded: { count: refundedCount, amount: refundedAmount },
      failed: { count: failedCount, amount: failedAmount },
      cancelled: { count: cancelledCount, amount: cancelledAmount },
      fees: { amount: estimatedFees, percent: feePercent },
      netRevenue,
    };
  }, [payments]);

  const handleFilterClick = (filterKey: StatsFilterType) => {
    if (!onFilterChange) return;
    // Toggle: if already active, clear filter
    onFilterChange(activeFilter === filterKey ? null : filterKey);
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/10 dark:border-slate-500/20 bg-gradient-to-br from-white/5 to-white/[0.02] dark:from-slate-500/10 dark:to-slate-600/5 backdrop-blur-xl p-6 shadow-lg">
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">Загрузка статистики...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard
        title="Успешные"
        amount={stats.successful.amount}
        count={stats.successful.count}
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        colorClass="text-emerald-500"
        accentGradient="from-emerald-500 to-emerald-400"
        isActive={activeFilter === 'successful'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('successful')}
      />
      <StatCard
        title="Возвраты"
        amount={stats.refunded.amount}
        count={stats.refunded.count}
        icon={<RotateCcw className="h-4 w-4 text-amber-500" />}
        colorClass="text-amber-500"
        accentGradient="from-amber-500 to-amber-400"
        isActive={activeFilter === 'refunded'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('refunded')}
      />
      <StatCard
        title="Отмены"
        amount={stats.cancelled.amount}
        count={stats.cancelled.count}
        icon={<XCircle className="h-4 w-4 text-orange-500" />}
        colorClass="text-orange-500"
        accentGradient="from-orange-500 to-orange-400"
        isActive={activeFilter === 'cancelled'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('cancelled')}
      />
      <StatCard
        title="Ошибки"
        amount={stats.failed.amount}
        count={stats.failed.count}
        icon={<XCircle className="h-4 w-4 text-rose-500" />}
        colorClass="text-rose-500"
        accentGradient="from-rose-500 to-rose-400"
        isActive={activeFilter === 'failed'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('failed')}
      />
      <StatCard
        title="Комиссия"
        amount={stats.fees.amount}
        count={stats.successful.count}
        subtitle={`${stats.fees.percent.toFixed(1)}%`}
        icon={<Percent className="h-4 w-4 text-sky-500" />}
        colorClass="text-sky-500"
        accentGradient="from-sky-500 to-sky-400"
        isClickable={false}
      />
      <StatCard
        title="Чистая выручка"
        amount={stats.netRevenue}
        count={stats.successful.count - stats.refunded.count}
        icon={<TrendingUp className="h-4 w-4 text-purple-500" />}
        colorClass="text-purple-500"
        accentGradient="from-purple-500 via-fuchsia-500 to-pink-400"
        isClickable={false}
      />
    </div>
  );
}
