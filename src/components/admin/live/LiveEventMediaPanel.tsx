import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileAudio, FileText, Loader2, RefreshCw, Sparkles, Download, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type MediaStatus = {
  audio: {
    status: "pending" | "copying" | "ready" | "no_audio" | "failed";
    source_file_name?: string | null;
    source_language?: string | null;
    size_bytes?: number | null;
    source_file_size?: number | null;
    error_code?: string | null;
  } | null;
  transcript: {
    status: "pending" | "processing" | "ready" | "failed";
    generated_at?: string | null;
    error_code?: string | null;
  } | null;
};

function sizeLabel(value?: number | null) {
  if (!value || value <= 0) return "Размер уточняется";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const audioStatusText: Record<NonNullable<MediaStatus["audio"]>["status"], string> = {
  pending: "Ожидает импорта",
  copying: "Сохраняется в платформе",
  ready: "Аудиофайл готов",
  no_audio: "Аудио не найдено",
  failed: "Ошибка импорта",
};

const transcriptStatusText: Record<NonNullable<MediaStatus["transcript"]>["status"], string> = {
  pending: "Ожидает запуска",
  processing: "Создаётся транскрибация",
  ready: "DOCX готов",
  failed: "Ошибка транскрибации",
};

export function LiveEventMediaPanel({ liveEventId }: { liveEventId: string }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<"sync_audio" | "start_transcript" | "audio" | "docx" | null>(null);
  const [awaitingTranscript, setAwaitingTranscript] = useState(false);
  const key = ["live-event-media", liveEventId];

  const statusQuery = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("live-event-media", {
        body: { action: "status", live_event_id: liveEventId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Не удалось получить статус материалов");
      return data as MediaStatus;
    },
    refetchInterval: (query) => {
      const status = query.state.data as MediaStatus | undefined;
      return status?.audio?.status === "copying" || status?.transcript?.status === "processing" || awaitingTranscript ? 5000 : false;
    },
  });

  const invoke = async (action: "sync_audio" | "start_transcript") => {
    setRunning(action);
    try {
      const { data, error } = await supabase.functions.invoke("live-event-media", {
        body: {
          action,
          live_event_id: liveEventId,
          force: action === "start_transcript" && statusQuery.data?.transcript?.status === "ready",
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        const messages: Record<string, string> = {
          replay_not_ready: "Сначала дождитесь готовой записи Kinescope и синхронизируйте источник.",
          video_processing: "Kinescope ещё обрабатывает запись. Попробуйте немного позже.",
          audio_not_available: "В записи Kinescope пока нет доступной аудиодорожки.",
          audio_not_ready: "Сначала сохраните аудиофайл эфира.",
        };
        throw new Error(messages[data?.code] || data?.error || "Операция пока недоступна");
      }
      if (action === "start_transcript") setAwaitingTranscript(true);
      toast.success(action === "sync_audio" ? "Аудиофайл эфира сохранён" : "Транскрибация запущена — статус обновится автоматически");
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выполнить операцию");
      await queryClient.invalidateQueries({ queryKey: key });
    } finally {
      setRunning(null);
    }
  };

  const download = async (kind: "audio" | "docx") => {
    setRunning(kind);
    try {
      const { data, error } = await supabase.functions.invoke("live-event-media", {
        body: { action: "download", kind, live_event_id: liveEventId },
      });
      if (error) throw error;
      if (!data?.ok || !data?.url) throw new Error(data?.error || "Файл пока недоступен");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось скачать файл");
    } finally {
      setRunning(null);
    }
  };

  const audio = statusQuery.data?.audio;
  const transcript = statusQuery.data?.transcript;
  const importing = running === "sync_audio" || audio?.status === "copying";
  const transcribing = running === "start_transcript" || transcript?.status === "processing" || awaitingTranscript;

  useEffect(() => {
    if (awaitingTranscript && ["processing", "ready", "failed"].includes(transcript?.status || "")) {
      setAwaitingTranscript(false);
    }
  }, [awaitingTranscript, transcript?.status]);

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        Материалы доступны только назначенному ведущему и администраторам. Аудио создаётся Kinescope один раз и затем хранится приватно в платформе.
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><FileAudio className="h-4 w-4 text-primary" /> Аудиофайл эфира</CardTitle>
          <CardDescription className="text-xs">Отдельная дорожка готовой записи Kinescope, сохранённая для скачивания и транскрибации.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={audio?.status === "ready" ? "default" : audio?.status === "failed" ? "destructive" : "secondary"}>
              {statusQuery.isLoading && !audio ? "Проверяю статус…" : audio ? audioStatusText[audio.status] : "Ещё не синхронизировано"}
            </Badge>
            {audio?.source_file_name && <span className="text-muted-foreground truncate max-w-[240px]">{audio.source_file_name}</span>}
            {audio?.source_language && <span className="text-muted-foreground">Язык: {audio.source_language}</span>}
            {audio && <span className="text-muted-foreground">{sizeLabel(audio.size_bytes || audio.source_file_size)}</span>}
          </div>
          {audio?.status === "failed" && <p className="text-xs text-destructive">Импорт не завершился ({audio.error_code || "неизвестная ошибка"}). Его можно безопасно повторить.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => invoke("sync_audio")} disabled={importing || statusQuery.isLoading}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {audio?.status === "ready" ? "Проверить аудио" : "Сохранить аудио"}
            </Button>
            {audio?.status === "ready" && (
              <Button size="sm" className="gap-1" onClick={() => download("audio")} disabled={running === "audio"}>
                {running === "audio" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Скачать аудио
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Транскрибация</CardTitle>
          <CardDescription className="text-xs">DOCX включает сводку, ключевые тезисы, практические шаги и полный текст эфира.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={transcript?.status === "ready" ? "default" : transcript?.status === "failed" ? "destructive" : "secondary"}>
              {statusQuery.isLoading && !transcript ? "Проверяю статус…" : transcript ? transcriptStatusText[transcript.status] : "Ещё не создавалась"}
            </Badge>
            {transcript?.generated_at && <span className="text-muted-foreground">Сформирована {new Date(transcript.generated_at).toLocaleString("ru-RU")}</span>}
          </div>
          {transcript?.status === "failed" && <p className="text-xs text-destructive">Не удалось подготовить документ ({transcript.error_code || "неизвестная ошибка"}). Можно повторить.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => invoke("start_transcript")} disabled={audio?.status !== "ready" || transcribing}>
              {transcribing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {transcript?.status === "ready" ? "Создать заново" : "Создать транскрибацию"}
            </Button>
            {transcript?.status === "ready" && (
              <Button size="sm" className="gap-1" onClick={() => download("docx")} disabled={running === "docx"}>
                {running === "docx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Скачать DOCX
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
