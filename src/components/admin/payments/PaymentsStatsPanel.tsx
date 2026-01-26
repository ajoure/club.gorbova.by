import { useMemo } from "react";
import { CheckCircle2, XCircle, RotateCcw, Percent, TrendingUp, Loader2 } from "lucide-react";
import { UnifiedPayment } from "@/hooks/useUnifiedPayments";
import { classifyPayment } from "@/lib/paymentClassification";

interface PaymentsStatsPanelProps {
  payments: UnifiedPayment[];
  isLoading?: boolean;
  dateRange?: { from: string; to?: string | null };
}

interface StatCardProps {
  title: string;
  amount: number;
  count: number;
  icon: React.ReactNode;
  colorClass: string;
  glowColor: string;
  currency?: string;
  subtitle?: string;
}

function StatCard({ title, amount, count, icon, colorClass, glowColor, currency = "BYN", subtitle }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-3xl transition-all duration-500 hover:scale-[1.03] hover:-translate-y-1">
      {/* Outer glow on hover - larger and softer */}
      <div className={`absolute -inset-1 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl ${glowColor}`} />
      
      {/* Main card - enhanced glass effect */}
      <div className="relative overflow-hidden rounded-3xl border border-white/30 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-3xl p-6 shadow-2xl shadow-black/5 dark:shadow-black/30">
        
        {/* Inner shine gradient - stronger */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-white/20 to-transparent dark:from-white/15 dark:via-white/5 pointer-events-none" />
        
        {/* Top edge highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/30" />
        
        {/* Left edge highlight */}
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-white/60 via-transparent to-transparent dark:from-white/20" />
        
        {/* Content */}
        <div className="relative z-10 flex flex-col gap-3">
          {/* Header with icon */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-[0.2em]">
              {title}
            </p>
            <div className={`p-2.5 rounded-2xl bg-gradient-to-br ${glowColor.replace('/20', '/10')} backdrop-blur-xl border border-white/30 dark:border-white/10 shadow-lg`}>
              {icon}
            </div>
          </div>
          
          {/* Amount - responsive sizing with wrapping for currency */}
          <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
            <span className={`text-2xl md:text-3xl font-bold tracking-tight tabular-nums min-w-0 ${colorClass}`}>
              {amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs md:text-sm font-semibold text-muted-foreground/60 shrink-0">
              {currency}
            </span>
          </div>
          
          {/* Count and subtitle */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <span className="font-semibold tabular-nums">{count.toLocaleString('ru-RU')} шт</span>
            {subtitle && (
              <>
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                <span>{subtitle}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentsStatsPanel({ payments, isLoading, dateRange }: PaymentsStatsPanelProps) {
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
      const fee = 0;
      
      switch (category) {
        case 'successful':
          successfulCount++;
          successfulAmount += absAmount;
          totalFees += fee;
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

    // If no fees from meta, estimate at ~2.04% (bePaid standard rate)
    const estimatedFees = totalFees === 0 && successfulAmount > 0 
      ? successfulAmount * 0.0204 
      : totalFees;
    
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

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-white/30 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-3xl p-8 shadow-2xl">
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Загрузка статистики...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Grid - 5 cards in row on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          title="Успешные"
          amount={stats.successful.amount}
          count={stats.successful.count}
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          colorClass="text-emerald-600 dark:text-emerald-400"
          glowColor="bg-emerald-500/20"
        />
        <StatCard
          title="Возвраты"
          amount={stats.refunded.amount}
          count={stats.refunded.count}
          icon={<RotateCcw className="h-5 w-5 text-orange-500" />}
          colorClass="text-orange-600 dark:text-orange-400"
          glowColor="bg-orange-500/20"
        />
        <StatCard
          title="Ошибки"
          amount={stats.failed.amount}
          count={stats.failed.count}
          icon={<XCircle className="h-5 w-5 text-red-500" />}
          colorClass="text-red-600 dark:text-red-400"
          glowColor="bg-red-500/20"
        />
        <StatCard
          title="Комиссия"
          amount={stats.fees.amount}
          count={stats.successful.count}
          subtitle={`${stats.fees.percent.toFixed(1)}%`}
          icon={<Percent className="h-5 w-5 text-blue-500" />}
          colorClass="text-blue-600 dark:text-blue-400"
          glowColor="bg-blue-500/20"
        />
        <StatCard
          title="Чистая выручка"
          amount={stats.netRevenue}
          count={stats.successful.count - stats.refunded.count}
          icon={<TrendingUp className="h-5 w-5 text-teal-500" />}
          colorClass="text-teal-600 dark:text-teal-400"
          glowColor="bg-teal-500/20"
        />
      </div>

      {/* Period indicator */}
      {dateRange && (
        <div className="text-xs text-muted-foreground/70 text-center font-medium">
          Период: {dateRange.from} — {dateRange.to || 'сегодня'}
        </div>
      )}
    </div>
  );
}
