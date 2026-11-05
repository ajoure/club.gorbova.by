import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

export type SiteRequest = Database["public"]["Functions"]["get_my_site_requests"]["Returns"][number];

export function SiteRequestListItem({ request }: { request: SiteRequest }) {
  return (
    <div className="p-4 rounded-xl border border-border/50 bg-card/50">
      <div className="flex items-start gap-3">
        <ClipboardList className="w-5 h-5 shrink-0 mt-1 text-primary" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-muted-foreground">Заявка с сайта</p>
          <h4 className="font-medium break-words">{request.product_name}</h4>
          {request.tariff_name && (
            <p className="text-sm text-muted-foreground break-words">Тариф: {request.tariff_name}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {format(new Date(request.submitted_at), "d MMMM yyyy", { locale: ru })}
            </span>
            <Badge variant="secondary">
              {request.status === "received" ? "Получена" : "Сохранена"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
