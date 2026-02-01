import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Package } from "lucide-react";
import { getProductName } from "@/lib/product-names";

interface CoursePreregistration {
  id: string;
  product_code: string;
  tariff_name: string | null;
  status: string;
  created_at: string;
  notes: string | null;
}

interface PreregistrationListItemProps {
  preregistration: CoursePreregistration;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  new: { label: "Новая", variant: "secondary" },
  confirmed: { label: "Подтверждена", variant: "default" },
  contacted: { label: "Связались", variant: "outline" },
  converted: { label: "Оплачено", variant: "default" },
  paid: { label: "Оплачено", variant: "default" },
  cancelled: { label: "Отменена", variant: "destructive" },
};

export function PreregistrationListItem({ preregistration }: PreregistrationListItemProps) {
  const status = statusConfig[preregistration.status] || { label: preregistration.status, variant: "secondary" as const };
  const productName = getProductName(preregistration.product_code);

  return (
    <div className="p-4 rounded-xl border border-border/50 bg-card/50 hover:bg-card/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h4 className="font-medium text-foreground truncate">{productName}</h4>
            {preregistration.tariff_name && (
              <p className="text-sm text-muted-foreground">Тариф: {preregistration.tariff_name}</p>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>{format(new Date(preregistration.created_at), "d MMMM yyyy", { locale: ru })}</span>
            </div>
          </div>
        </div>
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      </div>
    </div>
  );
}
