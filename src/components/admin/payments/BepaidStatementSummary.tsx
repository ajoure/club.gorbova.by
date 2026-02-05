 import { CreditCard, RotateCcw, XCircle, Percent, AlertTriangle, TrendingUp } from "lucide-react";
import { BepaidStatementStats } from "@/hooks/useBepaidStatement";
 import { GlassStatCard } from "./GlassStatCard";

export type StatementFilterType = 'payments' | 'refunds' | 'cancellations' | 'errors' | null;

interface BepaidStatementSummaryProps {
  stats: BepaidStatementStats | undefined;
  isLoading: boolean;
  activeFilter: StatementFilterType;
  onFilterChange: (filter: StatementFilterType) => void;
}

export function BepaidStatementSummary({ stats, isLoading, activeFilter, onFilterChange }: BepaidStatementSummaryProps) {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('ru-BY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const handleClick = (filter: StatementFilterType) => {
    onFilterChange(activeFilter === filter ? null : filter);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => (
           <div key={i} className="h-24 rounded-2xl bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const data = stats || {
    payments_count: 0,
    payments_amount: 0,
    refunds_count: 0,
    refunds_amount: 0,
    cancellations_count: 0,
    cancellations_amount: 0,
    errors_count: 0,
    errors_amount: 0,
    commission_total: 0,
    payout_total: 0,
    total_count: 0,
  };

  // Net revenue = Payments - Refunds - Cancellations - Commission
  const netRevenue = data.payments_amount 
    - data.refunds_amount 
    - data.cancellations_amount 
    - data.commission_total;

  return (
     <div className="relative isolate rounded-3xl p-4 overflow-hidden">
       {/* Dark gradient background - the "scene" for glass */}
       <div 
         className="absolute inset-0 -z-10"
         style={{ background: 'linear-gradient(135deg, #0B2A6F 0%, #123B8B 50%, #0A1E4A 100%)' }}
       />
       
       {/* Blurred color spots for depth */}
       <div className="absolute -z-10 top-[-100px] left-[-100px] h-[320px] w-[320px] rounded-full bg-cyan-400/25 blur-[90px] pointer-events-none" />
       <div className="absolute -z-10 bottom-[-140px] right-[-140px] h-[380px] w-[380px] rounded-full bg-violet-500/20 blur-[110px] pointer-events-none" />
       <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[280px] w-[280px] rounded-full bg-blue-500/15 blur-[100px] pointer-events-none" />
      
      {/* Stats grid */}
      <div className="relative grid grid-cols-2 md:grid-cols-6 gap-3">
       <GlassStatCard
        title="Платежи"
        value={formatAmount(data.payments_amount)}
        subtitle={`${data.payments_count} шт`}
        icon={<CreditCard className="h-4 w-4" />}
        variant="success"
        onClick={() => handleClick('payments')}
        isActive={activeFilter === 'payments'}
      />
       <GlassStatCard
        title="Возвраты"
        value={formatAmount(data.refunds_amount)}
        subtitle={`${data.refunds_count} шт`}
        icon={<RotateCcw className="h-4 w-4" />}
        variant="warning"
        onClick={() => handleClick('refunds')}
        isActive={activeFilter === 'refunds'}
      />
       <GlassStatCard
        title="Отмены"
        value={formatAmount(data.cancellations_amount)}
        subtitle={`${data.cancellations_count} шт`}
        icon={<XCircle className="h-4 w-4" />}
        variant="danger"
        onClick={() => handleClick('cancellations')}
        isActive={activeFilter === 'cancellations'}
      />
       <GlassStatCard
        title="Ошибки"
        value={formatAmount(data.errors_amount)}
        subtitle={`${data.errors_count} шт`}
        icon={<AlertTriangle className="h-4 w-4" />}
        variant="danger"
        onClick={() => handleClick('errors')}
        isActive={activeFilter === 'errors'}
      />
       <GlassStatCard
        title="Комиссия"
        value={formatAmount(data.commission_total)}
        icon={<Percent className="h-4 w-4" />}
         variant="info"
        isClickable={false}
      />
       <GlassStatCard
        title="Чистая выручка"
        value={formatAmount(netRevenue)}
        icon={<TrendingUp className="h-4 w-4" />}
        isClickable={false}
      />
      </div>
    </div>
  );
}
