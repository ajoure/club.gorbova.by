/**
 * Sprint B: AutowebSessionSelector — entry-point для autowebinar room.
 *
 * Монтируется в LiveEvent.tsx ДО комнаты, если:
 *   event_type === 'autowebinar' AND нет ?session=<uuid> в URL.
 *
 * Ветки:
 *   - scheduled    → список ближайших 3-5 слотов (TZ зрителя + TZ эфира)
 *   - just_in_time → кнопки офсетов из autoweb_config
 *   - on_demand    → одна кнопка «Начать сейчас»
 *   - one_time     → этот компонент НЕ показывается (legacy regression-safe)
 *
 * После выбора → setSearchParams({session: <uuid>}) → AutowebRoomRuntime монтируется.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarClock, Zap, PlayCircle, AlertCircle } from "lucide-react";
import { useAutowebSessionResolver, createAutowebPersonalSession } from "@/hooks/useAutowebSessionResolver";
import { formatDualTz } from "@/lib/autowebTzLabel";
import { toast } from "sonner";

interface Props {
  liveEventId: string;
  onSessionChosen: (sessionId: string) => void;
}

export function AutowebSessionSelector({ liveEventId, onSessionChosen }: Props) {
  const { data, isLoading, error, viewerTimezone } = useAutowebSessionResolver({ liveEventId });
  const [submitting, setSubmitting] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card className="p-8 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">Загружаем расписание…</span>
      </Card>
    );
  }

  if (error || !data || data.status !== "ok" || !data.mode) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
        <div>
          <div className="font-medium">Не удалось загрузить расписание</div>
          <div className="text-sm text-muted-foreground">
            {data?.status ? `Статус: ${data.status}` : "Попробуйте обновить страницу."}
          </div>
        </div>
      </Card>
    );
  }

  const eventTz = data.timezone || "Europe/Minsk";

  // one_time не должен сюда доходить (selector скрывается на уровне LiveEvent.tsx),
  // но на всякий случай обрабатываем — без выбора, пробрасываем ситуацию выше.
  if (data.mode === "one_time") {
    return null;
  }

  const handleCreatePersonal = async (offsetMinutes?: number) => {
    setSubmitting(offsetMinutes != null ? `jit-${offsetMinutes}` : "on_demand");
    try {
      const res = await createAutowebPersonalSession({ liveEventId, offsetMinutes });
      if (!res.ok || !res.sessionId) {
        toast.error(res.reason || "Не удалось создать сессию");
        return;
      }
      if (res.dedup) {
        toast.info("Используем уже созданную сессию");
      }
      onSessionChosen(res.sessionId);
    } finally {
      setSubmitting(null);
    }
  };

  if (data.mode === "scheduled") {
    const slots = data.scheduled?.upcoming ?? [];
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Выберите ближайший эфир</h2>
        </div>
        {slots.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Ближайших эфиров пока нет — заходите позже.
          </div>
        ) : (
          <div className="space-y-2">
            {slots.map((slot) => {
              const label = formatDualTz({ iso: slot.starts_at, viewerTz: viewerTimezone, eventTz });
              return (
                <button
                  key={slot.session_id}
                  onClick={() => onSessionChosen(slot.session_id)}
                  className="w-full text-left p-3 rounded-md border hover:border-primary hover:bg-primary/5 transition flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{label.primary}</div>
                    {label.secondary && (
                      <div className="text-xs text-muted-foreground">
                        в TZ эфира: {label.secondary} ({eventTz})
                      </div>
                    )}
                  </div>
                  <Badge variant="outline">Войти</Badge>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    );
  }

  if (data.mode === "just_in_time") {
    const options = data.just_in_time?.options ?? [];
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Когда начнём?</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {options.map((opt) => {
            const label = formatDualTz({ iso: opt.starts_at, viewerTz: viewerTimezone, eventTz });
            const key = `jit-${opt.offset_minutes}`;
            return (
              <Button
                key={key}
                variant="outline"
                disabled={submitting !== null}
                onClick={() => handleCreatePersonal(opt.offset_minutes)}
                className="flex flex-col h-auto py-3"
              >
                <span className="font-semibold">через {opt.offset_minutes} мин</span>
                <span className="text-xs text-muted-foreground mt-1">{label.primary}</span>
              </Button>
            );
          })}
        </div>
        {viewerTimezone !== eventTz && (
          <div className="text-xs text-muted-foreground mt-3">
            Время указано в вашем часовом поясе ({viewerTimezone}). TZ эфира: {eventTz}.
          </div>
        )}
      </Card>
    );
  }

  // on_demand
  const label = data.on_demand?.starts_at
    ? formatDualTz({ iso: data.on_demand.starts_at, viewerTz: viewerTimezone, eventTz })
    : null;
  return (
    <Card className="p-6 flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <PlayCircle className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">Готовы начать?</h2>
      </div>
      <div className="text-sm text-muted-foreground">
        Эфир запустится сразу после нажатия кнопки.
        {label && <> Старт: <strong>{label.primary}</strong>{label.secondary ? <> ({eventTz}: {label.secondary})</> : null}.</>}
      </div>
      <Button
        size="lg"
        disabled={submitting !== null}
        onClick={() => handleCreatePersonal()}
      >
        {submitting === "on_demand" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Начать сейчас
      </Button>
    </Card>
  );
}
