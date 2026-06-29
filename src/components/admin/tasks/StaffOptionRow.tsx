import { MessageCircleOff, MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StaffOption } from "@/hooks/useStaffOptions";

function initials(name?: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

/**
 * Содержимое SelectItem для сотрудника: аватар-инициалы (градиент)
 * + имя + индикатор привязки Telegram. Сам <SelectItem> остаётся снаружи,
 * чтобы радиксу было удобно ассоциировать value.
 */
export function StaffOptionRow({
  staff,
  className,
}: {
  staff: StaffOption;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <div
        className="h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shadow-sm bg-gradient-to-br from-sky-500 to-indigo-500"
        aria-hidden
      >
        {initials(staff.label)}
      </div>
      <span className="text-sm truncate flex-1">{staff.label}</span>
      {staff.telegram_linked ? (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-emerald-700"
          title="Telegram привязан — уведомление дойдёт"
        >
          <MessageCircle className="h-3 w-3" />
          TG
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
          title="Telegram не привязан — уведомление не дойдёт"
        >
          <MessageCircleOff className="h-3 w-3" />
          нет TG
        </span>
      )}
    </div>
  );
}
