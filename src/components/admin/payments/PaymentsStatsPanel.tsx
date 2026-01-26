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
  currency?: string;
  subtitle?: string;
}

function StatCard({ title, amount, count, icon, colorClass, currency = "BYN", subtitle }: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/30 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-xl p-4 transition-all hover:border-border/50 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className={`text-xl font-bold ${colorClass}`}>
            {amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
          </p>
          <p className="text-xs text-muted-foreground">
            {count.toLocaleString('ru-RU')} шт
            {subtitle && <span className="ml-1">· {subtitle}</span>}
          </p>
        </div>
        <div className={`p-2 rounded-lg ${colorClass.replace('text-', 'bg-').replace('-600', '-500/10').replace('-500', '-500/10')}`}>
          {icon}
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

      // Note: fees are not stored in UnifiedPayment, will be estimated
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
      <div className="rounded-xl border border-border/30 bg-gradient-to-br from-card/80 to-card/50 backdrop-blur-xl p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Загрузка статистики...</span>
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
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          colorClass="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          title="Возвраты"
          amount={stats.refunded.amount}
          count={stats.refunded.count}
          icon={<RotateCcw className="h-4 w-4 text-orange-500" />}
          colorClass="text-orange-600 dark:text-orange-400"
        />
        <StatCard
          title="Ошибки"
          amount={stats.failed.amount}
          count={stats.failed.count}
          icon={<XCircle className="h-4 w-4 text-red-500" />}
          colorClass="text-red-600 dark:text-red-400"
        />
        <StatCard
          title="Комиссия"
          amount={stats.fees.amount}
          count={stats.successful.count}
          subtitle={`${stats.fees.percent.toFixed(1)}%`}
          icon={<Percent className="h-4 w-4 text-blue-500" />}
          colorClass="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          title="Чистая выручка"
          amount={stats.netRevenue}
          count={stats.successful.count - stats.refunded.count}
          icon={<TrendingUp className="h-4 w-4 text-teal-500" />}
          colorClass="text-teal-600 dark:text-teal-400"
        />
      </div>

      {/* Period indicator */}
      {dateRange && (
        <div className="text-xs text-muted-foreground text-center">
          Период: {dateRange.from} — {dateRange.to}
        </div>
      )}
    </div>
  );
}
