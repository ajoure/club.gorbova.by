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
  accentGradient: string;
  currency?: string;
  subtitle?: string;
}

// Dark Luxury stat card
function StatCard({ title, amount, count, icon, colorClass, accentGradient, currency = "BYN", subtitle }: StatCardProps) {
  return (
    <div className="relative rounded-xl p-3 md:p-4 border border-slate-700/40 bg-slate-900/60 backdrop-blur-xl overflow-hidden transition-all duration-300 hover:border-slate-600/50 hover:bg-slate-900/70">
      {/* Gradient accent line top */}
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accentGradient}`} />
      
      {/* Header: title + icon inline */}
      <div className="relative z-10 flex items-center gap-2 mb-2">
        <div className="shrink-0">{icon}</div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
      </div>
      
      {/* Amount */}
      <div className={`relative z-10 text-lg md:text-xl font-bold tabular-nums ${colorClass} flex items-baseline gap-1.5 flex-wrap`}>
        <span>{amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span className="text-xs text-slate-500 font-medium">{currency}</span>
      </div>
      
      {/* Count and subtitle */}
      <div className="relative z-10 flex items-center gap-2 text-xs text-slate-500 mt-1.5">
        <span className="tabular-nums">{count.toLocaleString('ru-RU')} шт</span>
        {subtitle && (
          <>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-slate-400">{subtitle}</span>
          </>
        )}
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
      <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-xl p-6">
        <div className="flex items-center justify-center gap-3 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">Загрузка...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats Grid - 5 cards in row on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          title="Успешные"
          amount={stats.successful.amount}
          count={stats.successful.count}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          colorClass="text-emerald-400"
          accentGradient="from-emerald-500 to-emerald-400"
        />
        <StatCard
          title="Возвраты"
          amount={stats.refunded.amount}
          count={stats.refunded.count}
          icon={<RotateCcw className="h-4 w-4 text-amber-400" />}
          colorClass="text-amber-400"
          accentGradient="from-amber-500 to-amber-400"
        />
        <StatCard
          title="Ошибки"
          amount={stats.failed.amount}
          count={stats.failed.count}
          icon={<XCircle className="h-4 w-4 text-rose-400" />}
          colorClass="text-rose-400"
          accentGradient="from-rose-500 to-rose-400"
        />
        <StatCard
          title="Комиссия"
          amount={stats.fees.amount}
          count={stats.successful.count}
          subtitle={`${stats.fees.percent.toFixed(1)}%`}
          icon={<Percent className="h-4 w-4 text-sky-400" />}
          colorClass="text-sky-400"
          accentGradient="from-sky-500 to-sky-400"
        />
        <StatCard
          title="Чистая выручка"
          amount={stats.netRevenue}
          count={stats.successful.count - stats.refunded.count}
          icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          colorClass="text-purple-400"
          accentGradient="from-purple-500 via-fuchsia-500 to-pink-400"
        />
      </div>

      {/* Period indicator */}
      {dateRange && (
        <div className="text-[10px] text-slate-500 text-center font-medium tracking-wide">
          {dateRange.from} — {dateRange.to || 'сегодня'}
        </div>
      )}
    </div>
  );
}
