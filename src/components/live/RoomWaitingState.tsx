import { CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Props {
  scheduledAt?: string | null;
  eventTimezone?: string | null;
  /**
   * M1: compact-режим для mobile — убирает aspect-video и ужимает paddings,
   * чтобы waiting-card не вытесняла composer чата за первый экран.
   */
  compact?: boolean;
}

/**
 * Sprint 2 PATCH 2.5 + Sprint 3 PATCH 3.1: controlled waiting-state with room theme tokens.
 * Replaces the player when room_state='opened' (room open, stream not started).
 * Chat/questions/CTA/theme render normally via the room layout around this block.
 *
 * M1: при compact=true (mobile) карточка не держит aspect-video — рендерится
 * компактным баннером, чтобы поле ввода чата помещалось на первом экране.
 */
export function RoomWaitingState({ scheduledAt, eventTimezone, compact = false }: Props) {
  const containerClass = compact
    ? "room-waiting-card relative w-full rounded-lg overflow-hidden flex items-center justify-center min-h-[140px] py-4 px-4"
    : "room-waiting-card relative w-full aspect-video rounded-lg overflow-hidden flex items-center justify-center";

  const innerClass = compact
    ? "text-center w-full max-w-md"
    : "text-center px-6 py-8 max-w-md";

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        <div
          className={
            compact
              ? "room-waiting-icon mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-2"
              : "room-waiting-icon mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
          }
        >
          <CalendarClock className={compact ? "h-5 w-5" : "h-8 w-8"} />
        </div>
        <h3 className={compact ? "text-sm font-semibold room-title mb-1" : "text-lg font-semibold room-title mb-2"}>
          Комната открыта
        </h3>
        {!compact && (
          <p className="text-sm room-meta-text mb-3">
            Эфир скоро начнётся. Вы уже в комнате — можно общаться в чате и задавать вопросы.
            Плеер появится автоматически в момент старта.
          </p>
        )}
        {compact && (
          <p className="text-xs room-meta-text mb-2">
            Эфир скоро начнётся. Чат уже активен.
          </p>
        )}
        {scheduledAt && (
          <div className="room-waiting-badge inline-flex items-center gap-2 backdrop-blur rounded-md px-3 py-1.5 text-xs">
            <CalendarClock className="h-3.5 w-3.5" />
            {compact
              ? format(new Date(scheduledAt), "dd MMM, HH:mm", { locale: ru })
              : `Запланировано: ${format(new Date(scheduledAt), "dd MMM yyyy, HH:mm", { locale: ru })}`}
            {eventTimezone && !compact && <span className="opacity-70">({eventTimezone})</span>}
          </div>
        )}
      </div>
    </div>
  );
}
