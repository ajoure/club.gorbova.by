import { useNavigate } from "react-router-dom";
import { 
  Package, 
  CheckCircle, 
  Clock, 
  TrendingUp, 
  AlertTriangle, 
  XCircle,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DealsStatsBarProps {
  stats: {
    total: number;
    paid: number;
    pending: number;
    revenue: number;
  };
  healthStats?: {
    activeWithoutCard: number;
    trialsExpiring72h: number;
  } | null;
  autoPaymentStats?: {
    count: number;
    totalPlanned: number;
  } | null;
  currency?: string;
  onStatClick: (filter: string) => void;
  isLoading?: boolean;
}

interface StatItemProps {
  icon: React.ElementType;
  value: number | string;
  label: string;
  onClick?: () => void;
  className?: string;
  iconClassName?: string;
  valueClassName?: string;
}

function StatItem({ icon: Icon, value, label, onClick, className, iconClassName, valueClassName }: StatItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
        "hover:bg-accent/50 hover:scale-[1.02] active:scale-[0.98]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />
      <div className="text-left">
        <div className={cn("text-lg font-semibold leading-tight", valueClassName)}>{value}</div>
        <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
      </div>
    </button>
  );
}

function Divider() {
  return <div className="w-px h-10 bg-border/50 mx-1" />;
}

export function DealsStatsBar({
  stats,
  healthStats,
  autoPaymentStats,
  currency = "BYN",
  onStatClick,
  isLoading,
}: DealsStatsBarProps) {
  const navigate = useNavigate();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("ru-BY", { 
      style: "currency", 
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-background/60 backdrop-blur-sm border border-border/50 animate-pulse">
        <div className="h-10 w-24 bg-muted rounded" />
        <div className="h-10 w-24 bg-muted rounded" />
        <div className="h-10 w-24 bg-muted rounded" />
        <div className="h-10 w-32 bg-muted rounded" />
      </div>
    );
  }

  const showHealthStats = healthStats && (healthStats.activeWithoutCard > 0 || healthStats.trialsExpiring72h > 0);

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 rounded-xl bg-background/60 backdrop-blur-sm border border-border/50">
      {/* Main Stats */}
      <StatItem
        icon={Package}
        value={stats.total}
        label="Всего"
        onClick={() => onStatClick("all")}
        iconClassName="text-muted-foreground"
      />
      
      <StatItem
        icon={CheckCircle}
        value={stats.paid}
        label="Оплачено"
        onClick={() => onStatClick("paid")}
        iconClassName="text-green-600"
        valueClassName="text-green-600"
      />
      
      <StatItem
        icon={Clock}
        value={stats.pending}
        label="Ожидает"
        onClick={() => onStatClick("pending")}
        iconClassName="text-amber-600"
        valueClassName="text-amber-600"
      />
      
      <StatItem
        icon={TrendingUp}
        value={formatCurrency(stats.revenue)}
        label="Выручка"
        onClick={() => onStatClick("paid")}
        iconClassName="text-primary"
        valueClassName="text-primary"
      />

      {/* Auto Payments Stats */}
      {autoPaymentStats && autoPaymentStats.count > 0 && (
        <>
          <Divider />
          <StatItem
            icon={CalendarClock}
            value={`${autoPaymentStats.count}`}
            label={formatCurrency(autoPaymentStats.totalPlanned)}
            onClick={() => navigate("/admin/subscriptions-v2?filter=auto_renew")}
            iconClassName="text-blue-600"
            valueClassName="text-blue-600"
          />
        </>
      )}

      {/* Health Stats */}
      {showHealthStats && (
        <>
          <Divider />
          {healthStats.activeWithoutCard > 0 && (
            <StatItem
              icon={AlertTriangle}
              value={healthStats.activeWithoutCard}
              label="Под угрозой"
              onClick={() => navigate("/admin/subscriptions-v2?filter=active_no_card")}
              iconClassName="text-amber-500"
              valueClassName="text-amber-500"
            />
          )}
          {healthStats.trialsExpiring72h > 0 && (
            <StatItem
              icon={XCircle}
              value={healthStats.trialsExpiring72h}
              label="Срочно 72ч"
              onClick={() => navigate("/admin/subscriptions-v2?filter=trial_no_card")}
              iconClassName="text-red-500"
              valueClassName="text-red-500"
            />
          )}
        </>
      )}
    </div>
  );
}
