import { Badge } from "@/components/ui/badge";
import { Link2, CreditCard, Mail, GraduationCap, LucideIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, LucideIcon> = {
  Link2,
  CreditCard,
  Mail,
  GraduationCap,
};

interface IntegrationProviderCardProps {
  provider: {
    id: string;
    name: string;
    icon: string;
    description?: string;
  };
  instanceCount: number;
  hasErrors: boolean;
  onClick: () => void;
}

export function IntegrationProviderCard({
  provider,
  instanceCount,
  hasErrors,
  onClick,
}: IntegrationProviderCardProps) {
  const Icon = iconMap[provider.icon] || Link2;

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-3xl p-6 transition-all duration-500",
        "bg-gradient-to-br from-card via-card/95 to-primary/5",
        "border-2 shadow-xl",
        "hover:shadow-2xl hover:-translate-y-2 hover:scale-[1.02]",
        hasErrors 
          ? "border-destructive/40 shadow-destructive/10 hover:border-destructive/60 hover:shadow-destructive/20" 
          : "border-border/40 hover:border-primary/40 shadow-primary/5 hover:shadow-primary/15"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-5">
          <div className={cn(
            "relative h-14 w-14 rounded-2xl flex items-center justify-center transition-all duration-500",
            "bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10",
            "group-hover:from-primary/30 group-hover:via-primary/20 group-hover:to-accent/20",
            "shadow-lg shadow-primary/10 group-hover:shadow-xl group-hover:shadow-primary/20",
            "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-white/20 before:to-transparent before:opacity-0 before:transition-opacity before:duration-500",
            "group-hover:before:opacity-100"
          )}>
            <Icon className="h-7 w-7 text-primary transition-all duration-500 group-hover:scale-110" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-lg text-foreground tracking-tight">{provider.name}</h3>
            {provider.description && (
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[220px]">
                {provider.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {instanceCount > 0 && (
              <Badge 
                className="text-xs font-semibold bg-gradient-to-r from-primary/20 to-accent/20 text-primary border-0 px-3 py-1 shadow-sm"
              >
                {instanceCount} {instanceCount === 1 ? 'подключение' : 'подключения'}
              </Badge>
            )}
            {hasErrors && (
              <Badge 
                variant="destructive" 
                className="text-xs animate-pulse shadow-lg shadow-destructive/30"
              >
                Ошибка
              </Badge>
            )}
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all duration-300" />
        </div>
      </div>
    </div>
  );
}
