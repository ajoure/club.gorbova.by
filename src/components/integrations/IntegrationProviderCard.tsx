import { Card, CardContent } from "@/components/ui/card";
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
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
        hasErrors && "border-destructive/50"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium">{provider.name}</h3>
              {provider.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {provider.description}
                </p>
              )}
            </div>
          </div>
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
        </div>
      </CardContent>
    </Card>
  );
}
