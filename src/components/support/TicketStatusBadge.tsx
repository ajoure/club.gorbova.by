import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TicketStatusBadgeProps {
  status: "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
  className?: string;
  compact?: boolean;
}

const statusConfig: Record<
  string,
  { label: string; compactLabel: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }
> = {
  open: {
    label: "Открыт",
    compactLabel: "Откр.",
    variant: "destructive",
    className: "",
  },
  in_progress: {
    label: "В работе",
    compactLabel: "В работе",
    variant: "default",
    className: "bg-yellow-500 hover:bg-yellow-600",
  },
  waiting_user: {
    label: "Ожидает ответа",
    compactLabel: "Ожидает",
    variant: "default",
    className: "bg-blue-500 hover:bg-blue-600",
  },
  resolved: {
    label: "Решён",
    compactLabel: "Решён",
    variant: "default",
    className: "bg-green-500 hover:bg-green-600",
  },
  closed: {
    label: "Закрыт",
    compactLabel: "Закр.",
    variant: "secondary",
    className: "",
  },
};

export function TicketStatusBadge({ status, className, compact }: TicketStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.open;

  return (
    <Badge
      variant={config.variant}
      className={cn("text-[10px] px-1.5 py-0 h-5 whitespace-nowrap", config.className, className)}
    >
      {compact ? config.compactLabel : config.label}
    </Badge>
  );
}
