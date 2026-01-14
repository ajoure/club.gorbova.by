import { cn } from "@/lib/utils";
import { Database, CheckCircle, Clock, XCircle, Handshake } from "lucide-react";
import { PaymentsStats } from "@/hooks/useUnifiedPayments";
import { Skeleton } from "@/components/ui/skeleton";

export type DashboardFilter = 'all' | 'successful' | 'pending' | 'failed' | 'withDeal';

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
  isActive: boolean;
  onClick: () => void;
}

function DashboardCard({ title, value, subtitle, icon, colorClass, isActive, onClick }: DashboardCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-2xl p-4 text-left transition-all duration-300 ease-out",
        "backdrop-blur-xl bg-card/60 dark:bg-card/40",
        "border border-border/50 hover:border-border",
        "shadow-lg hover:shadow-xl",
        "group cursor-pointer",
        "min-h-[100px] flex flex-col", // Fixed height for consistency
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02]"
      )}
    >
      {/* Glassmorphism background effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      
      {/* Icon background glow */}
      <div className={cn(
        "absolute -top-4 -right-4 w-16 h-16 rounded-full opacity-20 blur-xl transition-opacity group-hover:opacity-30",
        colorClass
      )} />
      
      <div className="relative flex-1 flex flex-col justify-center">
        {/* Icon + Title */}
        <div className="flex items-center gap-2 mb-2">
          <div className={cn("flex-shrink-0", colorClass)}>
            {icon}
          </div>
          <span className="text-sm font-medium text-muted-foreground truncate">{title}</span>
        </div>
        
        {/* Value - centered */}
        <div className={cn("text-2xl font-bold tabular-nums text-center", colorClass)}>
          {value}
        </div>
        
        {/* Subtitle - centered */}
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 text-center truncate">{subtitle}</p>
        )}
      </div>
      
      {/* Active indicator */}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-b-xl" />
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
          <div key={i} className="rounded-2xl p-4 backdrop-blur-xl bg-card/60 border border-border/50 min-h-[100px]">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-8 w-16 mx-auto" />
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
        subtitle={`Обраб: ${stats.processed} | Очередь: ${stats.inQueue}`}
        icon={<Database className="h-4 w-4" />}
        colorClass="text-primary"
        isActive={activeFilter === 'all'}
        onClick={() => handleClick('all')}
      />
      
      <DashboardCard
        title="Успешные"
        value={stats.successful || 0}
        subtitle={`Контакт: ${stats.withContact}`}
        icon={<CheckCircle className="h-4 w-4" />}
        colorClass="text-green-500"
        isActive={activeFilter === 'successful'}
        onClick={() => handleClick('successful')}
      />
      
      <DashboardCard
        title="Ожидают"
        value={stats.pending || 0}
        subtitle="В обработке"
        icon={<Clock className="h-4 w-4" />}
        colorClass="text-amber-500"
        isActive={activeFilter === 'pending'}
        onClick={() => handleClick('pending')}
      />
      
      <DashboardCard
        title="Ошибки"
        value={stats.failed || 0}
        subtitle="Требуют проверки"
        icon={<XCircle className="h-4 w-4" />}
        colorClass="text-red-500"
        isActive={activeFilter === 'failed'}
        onClick={() => handleClick('failed')}
      />
      
      <DashboardCard
        title="Со сделкой"
        value={stats.withDeal}
        subtitle={`Без: ${stats.withoutDeal}`}
        icon={<Handshake className="h-4 w-4" />}
        colorClass="text-blue-500"
        isActive={activeFilter === 'withDeal'}
        onClick={() => handleClick('withDeal')}
      />
    </div>
  );
}
