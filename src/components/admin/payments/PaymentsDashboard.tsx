import { cn } from "@/lib/utils";
import { Database, CheckCircle, Clock, XCircle, Handshake, Ban } from "lucide-react";
import { PaymentsStats } from "@/hooks/useUnifiedPayments";
import { Skeleton } from "@/components/ui/skeleton";

export type DashboardFilter = 'all' | 'successful' | 'pending' | 'failed' | 'cancelled' | 'withDeal';

interface PaymentsDashboardProps {
  stats: PaymentsStats;
  isLoading: boolean;
  activeFilter: DashboardFilter | null;
  onFilterChange: (filter: DashboardFilter | null) => void;
}

interface DashboardCardProps {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ReactNode;
  colorClass: string;
  glowColor: string;
  isActive: boolean;
  onClick: () => void;
}

function DashboardCard({ title, value, subtitle, icon, colorClass, glowColor, isActive, onClick }: DashboardCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-300 ease-out",
        "backdrop-blur-2xl bg-gradient-to-br from-card/80 via-card/60 to-card/40",
        "border border-border/30 hover:border-border/60",
        "shadow-lg hover:shadow-xl",
        "group cursor-pointer",
        "min-h-[130px] flex flex-col",
        "hover:scale-[1.02] active:scale-[0.98]",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.01]"
      )}
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
      
      {/* Content - fully centered */}
      <div className="relative flex-1 flex flex-col items-center justify-center gap-2">
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
        
        {/* Title */}
        <span className="text-xs font-medium text-muted-foreground tracking-wide">
          {title}
        </span>
        
        {/* Value - large centered number */}
        <div className={cn(
          "text-3xl font-bold tabular-nums tracking-tight",
          "bg-gradient-to-b from-foreground to-foreground/80 bg-clip-text",
          colorClass
        )}>
          {value}
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
        <div className={cn("absolute bottom-0 left-0 right-0 h-1 rounded-b-xl", glowColor)} />
      )}
    </button>
  );
}

export default function PaymentsDashboard({ stats, isLoading, activeFilter, onFilterChange }: PaymentsDashboardProps) {
  const handleClick = (filter: DashboardFilter) => {
    onFilterChange(activeFilter === filter ? null : filter);
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="rounded-2xl p-5 backdrop-blur-2xl bg-card/60 border border-border/30 min-h-[130px] flex flex-col items-center justify-center gap-2">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <DashboardCard
        title="Всего"
        value={stats.total}
        subtitle={`Обраб: ${stats.processed} · Очередь: ${stats.inQueue}`}
        icon={<Database className="h-5 w-5" />}
        colorClass="text-primary"
        glowColor="bg-primary"
        isActive={activeFilter === 'all'}
        onClick={() => handleClick('all')}
      />
      
      <DashboardCard
        title="Успешные"
        value={stats.successful || 0}
        subtitle={`С контактом: ${stats.withContact}`}
        icon={<CheckCircle className="h-5 w-5" />}
        colorClass="text-green-500"
        glowColor="bg-green-500"
        isActive={activeFilter === 'successful'}
        onClick={() => handleClick('successful')}
      />
      
      <DashboardCard
        title="Ожидают"
        value={stats.pending || 0}
        subtitle="В обработке"
        icon={<Clock className="h-5 w-5" />}
        colorClass="text-amber-500"
        glowColor="bg-amber-500"
        isActive={activeFilter === 'pending'}
        onClick={() => handleClick('pending')}
      />
      
      <DashboardCard
        title="Ошибки"
        value={stats.failed || 0}
        subtitle="Требуют проверки"
        icon={<XCircle className="h-5 w-5" />}
        colorClass="text-red-500"
        glowColor="bg-red-500"
        isActive={activeFilter === 'failed'}
        onClick={() => handleClick('failed')}
      />
      
      <DashboardCard
        title="Отменённые"
        value={stats.cancelled || 0}
        subtitle="Истекшие/Отмены"
        icon={<Ban className="h-5 w-5" />}
        colorClass="text-gray-500"
        glowColor="bg-gray-500"
        isActive={activeFilter === 'cancelled'}
        onClick={() => handleClick('cancelled')}
      />
      
      <DashboardCard
        title="Со сделкой"
        value={stats.withDeal}
        subtitle={`Без сделки: ${stats.withoutDeal}`}
        icon={<Handshake className="h-5 w-5" />}
        colorClass="text-blue-500"
        glowColor="bg-blue-500"
        isActive={activeFilter === 'withDeal'}
        onClick={() => handleClick('withDeal')}
      />
    </div>
  );
}
