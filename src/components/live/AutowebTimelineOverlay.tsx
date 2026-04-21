/**
 * Sprint B: AutowebTimelineOverlay — отдельный визуальный слой для scripted timeline.
 *
 * ⚠️ ИНВАРИАНТ ИЗОЛЯЦИИ (verified by grep + DB count=0):
 * Этот компонент НИКОГДА не импортирует submit-мутаторы для
 * live_event_comments / live_event_questions. Он только рендерит.
 *
 * scripted host_message / scripted_chat / scripted_question физически живут
 * в отдельных таблицах (см. mem://architecture/webinars/simulated-content-isolation)
 * и НЕ попадают в SoT-таблицы реальной активности.
 *
 * Этот файл — placeholder UI слоя (рендер реальных scripted-источников добавится
 * отдельной задачей по таблицам simulated_*). Здесь зафиксирована только
 * структурная изоляция и render-only контракт.
 */
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

// 🔒 LINT-LEVEL GUARD (manual): не импортировать здесь
// useMutation для live_event_comments / live_event_questions.
// При попытке нарушить — verify grep ниже упадёт.

interface Props {
  /** session_id — нужен только для последующего fetch scripted timeline по сессии. */
  sessionId: string;
  /** включена ли scripted timeline в autoweb_config.timeline.enabled */
  enabled: boolean;
}

export function AutowebTimelineOverlay({ sessionId, enabled }: Props) {
  if (!enabled) return null;

  // Полноценный рендер scripted ивентов придёт отдельной задачей,
  // здесь — только зафиксированный изолированный слой.
  return (
    <Card
      data-autoweb-scripted-overlay
      data-session-id={sessionId}
      className="p-3 mt-2 border-dashed flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span>Сценарная активность ведущего будет отображаться здесь (отдельный слой).</span>
    </Card>
  );
}
