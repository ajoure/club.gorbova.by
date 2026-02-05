 import { useMemo } from "react";
 import { CheckCircle2, XCircle, RotateCcw, Percent, TrendingUp, Loader2 } from "lucide-react";
import { usePaymentsServerStats } from "@/hooks/usePaymentsServerStats";
 import { GlassStatCard } from "./GlassStatCard";

 // Payment filter types
 export type StatsFilterType = 'successful' | 'refunded' | 'cancelled' | 'failed' | null;

interface PaymentsStatsPanelProps {
  dateRange: { from: string; to?: string };
  isTableLoading?: boolean;
  activeFilter?: StatsFilterType;
  onFilterChange?: (filter: StatsFilterType) => void;
}

 const formatAmount = (amount: number) => {
   return new Intl.NumberFormat('ru-BY', {
     minimumFractionDigits: 2,
     maximumFractionDigits: 2,
   }).format(amount);
}

export default function PaymentsStatsPanel({ 
  dateRange,
  isTableLoading,
  activeFilter,
  onFilterChange,
}: PaymentsStatsPanelProps) {
  // Fetch server-side stats for the entire date range
  const { data: serverStats, isLoading: statsLoading } = usePaymentsServerStats(dateRange);
  
  const isLoading = isTableLoading || statsLoading;
  
  const stats = useMemo(() => {
    if (!serverStats) {
      return {
        successful: { count: 0, amount: 0 },
        refunded: { count: 0, amount: 0 },
        failed: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
        fees: { amount: 0, percent: 0 },
        netRevenue: 0,
      };
    }
    
    const feePercent = serverStats.successful_amount > 0 
      ? (serverStats.commission_total / serverStats.successful_amount) * 100 
      : 0;

    // Net revenue = Successful - Refunds - Cancellations - Commission
    const netRevenue = serverStats.successful_amount
      - serverStats.refunded_amount
      - serverStats.cancelled_amount
      - serverStats.commission_total;

    return {
      successful: { count: serverStats.successful_count, amount: serverStats.successful_amount },
      refunded: { count: serverStats.refunded_count, amount: serverStats.refunded_amount },
      failed: { count: serverStats.failed_count, amount: serverStats.failed_amount },
      cancelled: { count: serverStats.cancelled_count, amount: serverStats.cancelled_amount },
      fees: { amount: serverStats.commission_total, percent: feePercent },
      netRevenue,
    };
  }, [serverStats]);

  const handleFilterClick = (filterKey: StatsFilterType) => {
    if (!onFilterChange) return;
    // Toggle: if already active, clear filter
    onFilterChange(activeFilter === filterKey ? null : filterKey);
  };

  if (isLoading) {
    return (
       <div className="rounded-2xl border border-white/[0.12] backdrop-blur-2xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.08)]" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)' }}>
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium">Загрузка статистики...</span>
        </div>
      </div>
    );
  }

  return (
     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
       <GlassStatCard
        title="Успешные"
         value={formatAmount(stats.successful.amount)}
         subtitle={`${stats.successful.count} шт`}
        icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
         variant="success"
        isActive={activeFilter === 'successful'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('successful')}
      />
       <GlassStatCard
        title="Возвраты"
         value={formatAmount(stats.refunded.amount)}
         subtitle={`${stats.refunded.count} шт`}
        icon={<RotateCcw className="h-4 w-4 text-amber-500" />}
         variant="warning"
        isActive={activeFilter === 'refunded'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('refunded')}
      />
       <GlassStatCard
        title="Отмены"
         value={formatAmount(stats.cancelled.amount)}
         subtitle={`${stats.cancelled.count} шт`}
         icon={<XCircle className="h-4 w-4 text-rose-500" />}
         variant="danger"
        isActive={activeFilter === 'cancelled'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('cancelled')}
      />
       <GlassStatCard
        title="Ошибки"
         value={formatAmount(stats.failed.amount)}
         subtitle={`${stats.failed.count} шт`}
        icon={<XCircle className="h-4 w-4 text-rose-500" />}
         variant="danger"
        isActive={activeFilter === 'failed'}
        isClickable={!!onFilterChange}
        onClick={() => handleFilterClick('failed')}
      />
       <GlassStatCard
        title="Комиссия"
         value={formatAmount(stats.fees.amount)}
         subtitle={`${stats.fees.percent.toFixed(1)}% от оборота`}
        icon={<Percent className="h-4 w-4 text-sky-500" />}
         variant="info"
        isClickable={false}
      />
       <GlassStatCard
        title="Чистая выручка"
         value={formatAmount(stats.netRevenue)}
         subtitle={`${stats.successful.count - stats.refunded.count - stats.cancelled.count} платежей`}
        icon={<TrendingUp className="h-4 w-4 text-purple-500" />}
        isClickable={false}
      />
    </div>
  );
}
