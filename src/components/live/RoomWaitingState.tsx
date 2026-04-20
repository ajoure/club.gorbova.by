import { CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Props {
  scheduledAt?: string | null;
  eventTimezone?: string | null;
}

/**
 * Sprint 2 PATCH 2.5: controlled waiting-state.
 * Заменяет плеер, когда room_state='opened' (комната открыта, эфир не начат).
 * Чат / вопросы / CTA / тема — рендерятся обычным room layout вокруг этого блока.
 */
export function RoomWaitingState({ scheduledAt, eventTimezone }: Props) {
  return (
    <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
      <div className="text-center px-6 py-8 max-w-md">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <CalendarClock className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Комната открыта
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Эфир скоро начнётся. Вы уже в комнате — можно общаться в чате и задавать вопросы.
          Плеер появится автоматически в момент старта.
        </p>
        {scheduledAt && (
          <div className="inline-flex items-center gap-2 bg-background/60 backdrop-blur rounded-md px-3 py-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Запланировано: {format(new Date(scheduledAt), "dd MMM yyyy, HH:mm", { locale: ru })}
            {eventTimezone && <span className="opacity-70">({eventTimezone})</span>}
          </div>
        )}
      </div>
    </div>
  );
}
