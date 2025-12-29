import { Badge } from "@/components/ui/badge";
import { Link2, CreditCard, Mail, GraduationCap, LucideIcon } from "lucide-react";
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
        "group cursor-pointer rounded-2xl p-5 transition-all duration-300",
        "bg-card/50 backdrop-blur-xl border shadow-lg",
        "hover:shadow-xl hover:-translate-y-1 hover:bg-card/80",
        hasErrors 
          ? "border-destructive/30 hover:border-destructive/50" 
          : "border-border/50 hover:border-primary/30"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className={cn(
            "h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-300",
            "bg-gradient-to-br from-primary/10 to-primary/5",
            "group-hover:from-primary/20 group-hover:to-primary/10 group-hover:shadow-lg group-hover:shadow-primary/10"
          )}>
            <Icon className="h-6 w-6 text-primary transition-transform group-hover:scale-110" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{provider.name}</h3>
            {provider.description && (
              <p className="text-sm text-muted-foreground mt-0.5 max-w-[200px]">
                {provider.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {instanceCount > 0 && (
            <Badge 
              variant="secondary" 
              className="text-xs bg-primary/10 text-primary border-0 px-2.5 py-0.5"
            >
              {instanceCount}
            </Badge>
          )}
          {hasErrors && (
            <Badge 
              variant="destructive" 
              className="text-xs animate-pulse"
            >
              Ошибка
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
