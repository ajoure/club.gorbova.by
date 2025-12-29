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
        "group cursor-pointer rounded-2xl p-5 transition-all duration-300",
        "bg-card border shadow-sm",
        "hover:shadow-md hover:-translate-y-0.5",
        hasErrors 
          ? "border-destructive/50" 
          : "border-border hover:border-primary/30"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className={cn(
            "h-12 w-12 rounded-xl flex items-center justify-center",
            "bg-primary/10"
          )}>
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-0.5">
            <h3 className="font-semibold text-foreground">{provider.name}</h3>
            {provider.description && (
              <p className="text-sm text-muted-foreground max-w-[200px]">
                {provider.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {instanceCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {instanceCount}
              </Badge>
            )}
            {hasErrors && (
              <Badge variant="destructive" className="text-xs">
                Ошибка
              </Badge>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
      </div>
    </div>
  );
}
