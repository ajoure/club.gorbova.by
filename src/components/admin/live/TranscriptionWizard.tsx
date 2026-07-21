import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Play } from "lucide-react";
import { useAdminTranscriptionRunner, type TranscriptionStage } from "@/hooks/useAdminTranscriptionRunner";

type Props = {
  liveEventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  autoStart?: boolean;
};

const STAGE_TITLE: Record<TranscriptionStage, string> = {
  idle: "Готов к запуску",
  downloading_audio: "Сохраняем аудио",
  decoding: "Готовим аудио к обработке",
  planning: "Подготавливаем части",
  uploading: "Отправляем часть",
  transcribing: "Распознаём речь",
  finalizing: "Собираем DOCX",
  ready: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено",
};

export function TranscriptionWizard({ liveEventId, open, onOpenChange, onCompleted, autoStart }: Props) {
  const { state, run, cancel, reset, refreshStatus } = useAdminTranscriptionRunner(liveEventId);

  useEffect(() => {
    if (!open) return;
    void refreshStatus().catch(() => {});
  }, [open, refreshStatus]);

  useEffect(() => {
    if (open && autoStart && state.stage === "idle") {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStart]);

  useEffect(() => {
    if (state.stage === "ready" && onCompleted) onCompleted();
  }, [state.stage, onCompleted]);

  const running = ["downloading_audio", "decoding", "planning", "uploading", "transcribing", "finalizing"].includes(state.stage);
  const failed = state.stage === "failed";
  const done = state.stage === "ready";
  const cancelled = state.stage === "cancelled";

  const handleClose = () => {
    if (running) return; // блокируем закрытие во время активной работы
    onOpenChange(false);
    if (done) reset();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => { if (running) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (running) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {done ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : failed ? <XCircle className="h-5 w-5 text-destructive" /> : running ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Play className="h-5 w-5 text-primary" />}
            Транскрибация эфира
          </DialogTitle>
          <DialogDescription>
            {done
              ? "Всё сохранено. Аудио и DOCX готовы — вкладку можно закрыть."
              : running
              ? "Обычно 10–15 минут, зависит от устройства и длины записи. Не закрывайте вкладку — обработка идёт в этом окне."
              : failed
              ? "Часть работы не завершилась. Готовые фрагменты уже сохранены на сервере — можно продолжить с того же места."
              : cancelled
              ? "Обработка отменена. Сохранённые части остаются на сервере — можно продолжить в любой момент."
              : "Браузерная вкладка помогает подготовить длинную запись по частям, потом сервер собирает документ."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>{STAGE_TITLE[state.stage]}</span>
              <span>{state.percent}%</span>
            </div>
            <Progress value={state.percent} />
            <div className="mt-2 text-xs text-muted-foreground">
              {state.totalParts > 0
                ? `Готово частей: ${state.completedParts} из ${state.totalParts}${state.currentPartIndex !== null ? ` · сейчас часть ${state.currentPartIndex + 1}` : ""}`
                : "Определяем количество частей…"}
            </div>
          </div>

          {failed && state.error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Ошибка</AlertTitle>
              <AlertDescription className="text-xs break-all">{state.error}</AlertDescription>
            </Alert>
          )}

          {done && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Готово</AlertTitle>
              <AlertDescription>
                Аудио и DOCX сохранены в разделе «Материалы» эфира. Кнопки скачивания активны — можно закрыть окно.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(state.stage === "idle" || cancelled) && (
            <Button onClick={() => void run()} className="gap-2">
              <Play className="h-4 w-4" />
              {cancelled || state.canResume ? "Продолжить обработку" : "Запустить транскрибацию"}
            </Button>
          )}
          {failed && (
            <Button onClick={() => void run()} className="gap-2">
              <Play className="h-4 w-4" /> Повторить
            </Button>
          )}
          {running && (
            <Button variant="outline" onClick={() => void cancel()}>
              Приостановить
            </Button>
          )}
          {(done || failed || cancelled || state.stage === "idle") && (
            <Button variant="ghost" onClick={handleClose}>
              {done ? "Закрыть" : "Скрыть окно"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
