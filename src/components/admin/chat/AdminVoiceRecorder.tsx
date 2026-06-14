// PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1
// Voice recorder dialog for admin Telegram chat composer.
// Reuses shared audioRecorderCore utilities; does NOT depend on support/VoiceRecorder.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Mic, Square, Send, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_SEC,
  extFromRecorderMime,
  formatRecorderTime,
  isMediaRecorderAvailable,
  pickRecorderMime,
} from "@/lib/audioRecorderCore";

interface AdminVoiceRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (file: File) => void;
}

type RecState = "idle" | "recording" | "preview";

export function AdminVoiceRecorder({ open, onOpenChange, onRecorded }: AdminVoiceRecorderProps) {
  const [state, setState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);
  const sentRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    streamRef.current = null;
    mrRef.current = null;
    startedRef.current = false;
  }, []);

  // Revoke preview URL whenever it changes / on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Reset state when dialog closes; also kill stream if user closes mid-record
  useEffect(() => {
    if (!open) {
      cleanup();
      setState("idle");
      setSeconds(0);
      setBlob(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      chunksRef.current = [];
      sentRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Guard browser support on open
  useEffect(() => {
    if (open && state === "idle" && !isMediaRecorderAvailable()) {
      toast.error("Браузер не поддерживает запись аудио");
      onOpenChange(false);
    }
  }, [open, state, onOpenChange]);

  const startRecording = useCallback(async () => {
    if (startedRef.current) return; // double-start guard
    startedRef.current = true;
    try {
      chunksRef.current = [];
      setBlob(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setSeconds(0);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickRecorderMime();
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mrRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onerror = (e: Event) => {
        console.error("[AdminVoiceRecorder] MediaRecorder error", e);
        toast.error("Ошибка записи. Попробуйте снова.");
        cleanup();
        setState("idle");
      };

      mr.onstop = () => {
        const actualMime = mr.mimeType || mime || "audio/webm";
        const b = new Blob(chunksRef.current, { type: actualMime });

        if (b.size < 200) {
          toast.error("Запись пустая. Попробуйте ещё раз.");
          setState("idle");
          return;
        }
        if (b.size > MAX_VOICE_BYTES) {
          toast.error(`Запись слишком большая (макс. ${MAX_VOICE_BYTES / 1024 / 1024} МБ)`);
          setState("idle");
          return;
        }
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
        setState("preview");
      };

      mr.start(1000);
      setState("recording");

      const start = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - start) / 1000);
        setSeconds(s);
        if (s >= MAX_VOICE_DURATION_SEC) {
          if (mr.state === "recording") mr.stop();
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }, 250);
    } catch (e: any) {
      startedRef.current = false;
      const name = e?.name as string | undefined;
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast.error("Нет доступа к микрофону. Разрешите в настройках браузера.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        toast.error("Микрофон не найден.");
      } else if (name === "NotReadableError") {
        toast.error("Микрофон занят другим приложением.");
      } else {
        toast.error("Не удалось начать запись");
      }
      cleanup();
      setState("idle");
    }
  }, [cleanup, previewUrl]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const mr = mrRef.current;
    if (mr && mr.state === "recording") {
      try {
        mr.stop();
      } catch {
        // ignore
      }
    }
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    streamRef.current = null;
    startedRef.current = false;
  }, []);

  const handleRetry = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setBlob(null);
    setSeconds(0);
    setState("idle");
  }, [previewUrl]);

  const handleSend = useCallback(() => {
    if (!blob || sentRef.current) return;
    sentRef.current = true;
    const mime = blob.type || pickRecorderMime() || "audio/webm";
    const ext = extFromRecorderMime(mime);
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
    onRecorded(file);
    onOpenChange(false);
  }, [blob, onRecorded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Запись голосового</DialogTitle>
          <DialogDescription>
            До {MAX_VOICE_DURATION_SEC / 60} минут. Будет отправлено как голосовое сообщение Telegram.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="text-2xl font-mono tabular-nums">
            {state === "recording" && (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
                {formatRecorderTime(seconds)}
              </span>
            )}
            {state === "preview" && <span>{formatRecorderTime(seconds)}</span>}
            {state === "idle" && <span className="text-muted-foreground">00:00</span>}
          </div>

          {state === "preview" && previewUrl && (
            <audio
              controls
              src={previewUrl}
              preload="metadata"
              className="w-full max-w-[280px]"
            />
          )}

          <div className="flex gap-3 flex-wrap justify-center">
            {state === "idle" && (
              <Button onClick={startRecording} className="gap-2">
                <Mic className="h-4 w-4" />
                Записать
              </Button>
            )}
            {state === "recording" && (
              <Button onClick={stopRecording} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />
                Остановить
              </Button>
            )}
            {state === "preview" && (
              <>
                <Button onClick={handleRetry} variant="outline" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Перезаписать
                </Button>
                <Button onClick={handleSend} className="gap-2">
                  <Send className="h-4 w-4" />
                  Отправить
                </Button>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={state === "recording"}
          >
            Отменить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
