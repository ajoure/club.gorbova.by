import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, PlayCircle, RefreshCw, RotateCcw, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useAdminTranscriptionRunner, type RunnerPhase } from "@/hooks/useAdminTranscriptionRunner";

const PHASE_LABEL: Record<RunnerPhase, string> = {
  idle: "Готово к запуску",
  loading_audio: "Загружаем сохранённый аудиофайл",
  chunking: "Готовим окна",

  creating_job: "Создаю задачу",
  registering_parts: "Регистрирую окна",
  transcribing: "Транскрибирую окна",
  finalizing: "Собираю DOCX",
  ready: "Транскрипт готов",
  failed: "Ошибка — можно повторить",
  cancelled: "Отменено",
};

function humanBytes(n: number | null) {
  if (!n) return "—";
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(1)} МБ`;
}

function humanMs(ms: number | null) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}м ${s % 60}с`;
}

type Props = { liveEventId: string; onFinished?: () => void };

export function TranscriptionWizard({ liveEventId, onFinished }: Props) {
  const { state, start, resume, retryFailed, cancel, refresh } = useAdminTranscriptionRunner(liveEventId);
  const percent = state.totalParts > 0 ? Math.round((state.completedParts / state.totalParts) * 100) : 0;
  const canFreshStart = !state.isActive && state.phase === "idle" && !state.jobId;
  const canRetry = state.phase === "failed" && state.failedParts > 0;
  const canResume =
    !state.isActive &&
    !!state.jobId &&
    (state.phase === "failed" || state.phase === "cancelled") &&
    state.completedParts < state.totalParts &&
    state.failedParts === 0;
  const failedList = useMemo(() => state.parts.filter((p) => p.status === "failed"), [state.parts]);
  const isSuccess = state.phase === "ready";

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">Частичная транскрибация в браузере</span>
            <Badge variant={isSuccess ? "default" : state.phase === "failed" ? "destructive" : "secondary"}>
              {PHASE_LABEL[state.phase]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Для длинных записей (свыше ≈24 МБ). Аудио скачивается в браузер, режется на окна по 90 секунд и передаётся серверу по частям.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={refresh} disabled={state.isActive} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" />Обновить
          </Button>
          {canFreshStart && (
            <Button size="sm" onClick={async () => { await start(); onFinished?.(); }} className="gap-1">
              <PlayCircle className="h-3.5 w-3.5" />Запустить
            </Button>
          )}
          {canResume && (
            <Button size="sm" onClick={async () => { await resume(); onFinished?.(); }} className="gap-1">
              <PlayCircle className="h-3.5 w-3.5" />Возобновить
            </Button>
          )}
          {canRetry && (
            <Button size="sm" variant="secondary" onClick={async () => { await retryFailed(); onFinished?.(); }} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />Повторить {state.failedParts}
            </Button>
          )}
          {state.isActive && (
            <Button size="sm" variant="destructive" onClick={cancel} className="gap-1">
              <StopCircle className="h-3.5 w-3.5" />Отменить
            </Button>
          )}
        </div>
      </div>

      {state.isActive && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Не закрывайте вкладку и не переводите ноутбук в сон.</strong> Ориентировочно 10–15 минут на эфир 60–90 минут. Если закроете — сможете возобновить, но незавершённые окна придётся переслать.
          </span>
        </div>
      )}

      {state.totalParts > 0 && (
        <div className="space-y-1.5">
          <Progress value={percent} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Окна: {state.completedParts}/{state.totalParts} ({percent}%)
              {state.failedParts ? ` · ${state.failedParts} с ошибкой` : ""}
              {state.currentPartIndex != null ? ` · сейчас #${state.currentPartIndex + 1}` : ""}
            </span>
            <span>{humanBytes(state.audioSizeBytes)} · {humanMs(state.audioDurationMs)}</span>
          </div>
        </div>
      )}

      {state.isActive && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{state.message || "Работаю…"}</span>
        </div>
      )}

      {isSuccess && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Всё сохранено. Вкладку можно закрывать — DOCX доступен в блоке «Транскрипция».</span>
        </div>
      )}

      {state.errorMessage && !isSuccess && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
          <span className="break-all">{state.errorMessage}</span>
        </div>
      )}

      {failedList.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Окна с ошибкой: {failedList.map((p) => `#${p.partIndex + 1}`).join(", ")}
        </div>
      )}
    </div>
  );
}
