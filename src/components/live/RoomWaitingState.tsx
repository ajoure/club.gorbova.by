import { CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Props {
  scheduledAt?: string | null;
  eventTimezone?: string | null;
}

/**
 * Sprint 2 PATCH 2.5 + Sprint 3 PATCH 3.1: controlled waiting-state with room theme tokens.
 * Replaces the player when room_state='opened' (room open, stream not started).
 * Chat/questions/CTA/theme render normally via the room layout around this block.
 */
export function RoomWaitingState({ scheduledAt, eventTimezone }: Props) {
  return (
    <div className="room-waiting-card relative w-full aspect-video rounded-lg overflow-hidden flex items-center justify-center">
      <div className="text-center px-6 py-8 max-w-md">
        <div className="room-waiting-icon mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4">
          <CalendarClock className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-semibold room-title mb-2">
          Комната открыта
        </h3>
        <p className="text-sm room-meta-text mb-3">
          Эфир скоро начнётся. Вы уже в комнате — можно общаться в чате и задавать вопросы.
          Плеер появится автоматически в момент старта.
        </p>
        {scheduledAt && (
          <div className="room-waiting-badge inline-flex items-center gap-2 backdrop-blur rounded-md px-3 py-1.5 text-xs">
            <CalendarClock className="h-3.5 w-3.5" />
            Запланировано: {format(new Date(scheduledAt), "dd MMM yyyy, HH:mm", { locale: ru })}
            {eventTimezone && <span className="opacity-70">({eventTimezone})</span>}
          </div>
        )}
      </div>
    </div>
  );
}
