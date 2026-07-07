import { useMemo } from "react";
import { CheckCircle2, XCircle, RotateCcw, Percent, TrendingUp, Loader2 } from "lucide-react";
import { GlassStatCard } from "./GlassStatCard";
import type { UnifiedPayment } from "@/hooks/useUnifiedPayments";

export type StatsFilterType = 'successful' | 'refunded' | 'cancelled' | 'failed' | null;

interface PaymentsStatsPanelProps {
  payments: UnifiedPayment[];
  isTableLoading?: boolean;
  activeFilter?: StatsFilterType;
  onFilterChange?: (filter: StatsFilterType) => void;
}

const normalizeType = (raw: string | null | undefined) => {
  const v = (raw || '').toLowerCase().trim();
  if (!v) return 'payment';
  if (['refund', 'refunded', 'возврат средств', 'возврат'].includes(v)) return 'refund';
  if (['void', 'canceled', 'cancelled', 'отмена', 'cancellation', 'authorization_void'].includes(v)) return 'void';
  return v;
};

const parseNumeric = (raw: unknown): number => {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

type CurrencyMap = Map<string, number>;
const addTo = (map: CurrencyMap, currency: string, amount: number) => {
  const cur = (currency || '—').toUpperCase();
  map.set(cur, (map.get(cur) || 0) + amount);
};

const formatCurrencyMap = (map: CurrencyMap): string => {
  if (map.size === 0) return '0,00';
  const entries = Array.from(map.entries())
    .filter(([, amt]) => Math.abs(amt) > 0.0001)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    // Показываем 0 в основной валюте (первой в map), либо просто 0,00
    const primary = map.keys().next().value ?? '';
    return primary
      ? `0,00 ${primary}`
      : '0,00';
  }
  return entries
    .map(([cur, amt]) =>
      `${amt.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`
    )
    .join(' + ');
};

export default function PaymentsStatsPanel({
  payments,
  isTableLoading,
  activeFilter,
  onFilterChange,
}: PaymentsStatsPanelProps) {
  const stats = useMemo(() => {
    const successful: CurrencyMap = new Map();
    const refunded: CurrencyMap = new Map();
    const cancelled: CurrencyMap = new Map();
    const failed: CurrencyMap = new Map();
    const commission: CurrencyMap = new Map();
    let successCount = 0;
    let refundCount = 0;
    let cancelCount = 0;
    let failCount = 0;

    for (const p of payments) {
      const status = (p.status_normalized || '').toLowerCase();
      const type = normalizeType(p.transaction_type);
      const amount = Number(p.amount || 0);
      const currency = (p.currency || '').toUpperCase() || 'BYN';

      const isCancelled = type === 'void' || ['cancelled', 'canceled', 'void'].includes(status);
      const isRefund = type === 'refund' || status === 'refunded' || amount < 0;
      const isSuccess =
        !isCancelled &&
        !isRefund &&
        ['successful', 'succeeded'].includes(status) &&
        amount > 0;
      const isFailed =
        !isCancelled &&
        ['failed', 'declined', 'expired', 'error', 'incomplete'].includes(status);

      if (isSuccess) {
        successCount += 1;
        addTo(successful, currency, amount);
        // commission_total is exposed at top level by useUnifiedPayments (extracted from bePaid meta).
        const fee = parseNumeric((p as unknown as { commission_total?: number | string | null }).commission_total);
        if (fee) addTo(commission, currency, fee);
      } else if (isRefund) {
        refundCount += 1;
        addTo(refunded, currency, Math.abs(amount));
      } else if (isCancelled) {
        cancelCount += 1;
        addTo(cancelled, currency, Math.abs(amount));
      } else if (isFailed) {
        failCount += 1;
        addTo(failed, currency, Math.abs(amount));
      }
    }

    // Net revenue per currency = successful - refunded - cancelled - commission
    const net: CurrencyMap = new Map(successful);
    for (const [cur, amt] of refunded) addTo(net, cur, -amt);
    for (const [cur, amt] of cancelled) addTo(net, cur, -amt);
    for (const [cur, amt] of commission) addTo(net, cur, -amt);

    // Fee percent: only for BYN slice to avoid mixing currencies; if no BYN — first currency
    const feePrimary = commission.has('BYN') ? 'BYN' : (commission.keys().next().value ?? 'BYN');
    const successBase = successful.get(feePrimary) || 0;
    const feeAmt = commission.get(feePrimary) || 0;
    const feePercent = successBase > 0 ? (feeAmt / successBase) * 100 : 0;

    return {
      successful,
      refunded,
      cancelled,
      failed,
      commission,
      net,
      successCount,
      refundCount,
      cancelCount,
      failCount,
      feePercent,
    };
  }, [payments]);

  if (isTableLoading) {
    return (
      <div className="relative isolate rounded-3xl p-6 overflow-hidden">
        <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(135deg, #0B2A6F 0%, #123B8B 50%, #0A1E4A 100%)' }} />
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs font-medium text-white/70">Загрузка статистики...</span>
        </div>
      </div>
    );
  }

  const handleFilterClick = (filterKey: StatsFilterType) => {
    if (!onFilterChange) return;
    onFilterChange(activeFilter === filterKey ? null : filterKey);
  };

  const netCount = stats.successCount - stats.refundCount - stats.cancelCount;

  return (
    <div className="relative isolate rounded-3xl p-4 overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(135deg, #0B2A6F 0%, #123B8B 50%, #0A1E4A 100%)' }}
      />
      <div className="absolute -z-10 top-[-100px] left-[-100px] h-[320px] w-[320px] rounded-full bg-cyan-400/25 blur-[90px] pointer-events-none" />
      <div className="absolute -z-10 bottom-[-140px] right-[-140px] h-[380px] w-[380px] rounded-full bg-violet-500/20 blur-[110px] pointer-events-none" />
      <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[280px] w-[280px] rounded-full bg-blue-500/15 blur-[100px] pointer-events-none" />

      <div
        data-table-scroll-x="true"
        className="relative table-scroll-x flex md:grid gap-3 md:grid-cols-3 lg:grid-cols-6 snap-x snap-mandatory md:snap-none -mx-1 px-1 md:mx-0 md:px-0 [&>*]:shrink-0 md:[&>*]:shrink [&>*]:basis-[44%] sm:[&>*]:basis-[30%] md:[&>*]:basis-auto [&>*]:snap-start"
      >
        <GlassStatCard
          title="Успешные"
          value={formatCurrencyMap(stats.successful)}
          subtitle={`${stats.successCount} шт`}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          variant="success"
          isActive={activeFilter === 'successful'}
          isClickable={!!onFilterChange}
          onClick={() => handleFilterClick('successful')}
        />
        <GlassStatCard
          title="Возвраты"
          value={formatCurrencyMap(stats.refunded)}
          subtitle={`${stats.refundCount} шт`}
          icon={<RotateCcw className="h-4 w-4 text-amber-500" />}
          variant="warning"
          isActive={activeFilter === 'refunded'}
          isClickable={!!onFilterChange}
          onClick={() => handleFilterClick('refunded')}
        />
        <GlassStatCard
          title="Отмены"
          value={formatCurrencyMap(stats.cancelled)}
          subtitle={`${stats.cancelCount} шт`}
          icon={<XCircle className="h-4 w-4 text-rose-500" />}
          variant="danger"
          isActive={activeFilter === 'cancelled'}
          isClickable={!!onFilterChange}
          onClick={() => handleFilterClick('cancelled')}
        />
        <GlassStatCard
          title="Ошибки"
          value={formatCurrencyMap(stats.failed)}
          subtitle={`${stats.failCount} шт`}
          icon={<XCircle className="h-4 w-4 text-rose-500" />}
          variant="danger"
          isActive={activeFilter === 'failed'}
          isClickable={!!onFilterChange}
          onClick={() => handleFilterClick('failed')}
        />
        <GlassStatCard
          title="Комиссия"
          value={formatCurrencyMap(stats.commission)}
          subtitle={`${stats.feePercent.toFixed(1)}% от оборота`}
          icon={<Percent className="h-4 w-4 text-sky-500" />}
          variant="info"
          isClickable={false}
        />
        <GlassStatCard
          title="Чистая выручка"
          value={formatCurrencyMap(stats.net)}
          subtitle={`${netCount} платежей`}
          icon={<TrendingUp className="h-4 w-4 text-purple-500" />}
          isClickable={false}
        />
      </div>
    </div>
  );
}
