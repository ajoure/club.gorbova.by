import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Circle, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";

interface VideoNoteRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (file: File) => void;
}

type RecorderState = "idle" | "ready" | "recording" | "preview" | "error";

export function VideoNoteRecorder({ open, onOpenChange, onRecorded }: VideoNoteRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);

  // diagnostics (особенно полезно для iOS Safari)
  const [diagRequestedMime, setDiagRequestedMime] = useState<string | null>(null);
  const [diagActualMime, setDiagActualMime] = useState<string | null>(null);
  const [diagChunkCount, setDiagChunkCount] = useState<number>(0);
  const [diagChunkBytes, setDiagChunkBytes] = useState<number>(0);
  const [diagRecorderError, setDiagRecorderError] = useState<string | null>(null);

  const MAX_DURATION_SEC = 60;

  const isSafari = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
  }, []);

  // В iOS Safari mimeType часто "supported", но запись выходит пустой.
  // Поэтому в Safari даём браузеру выбрать формат самостоятельно.
  const preferredMimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") return null;
    if (isSafari) return null;

    const candidates = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4",
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];

    const isTypeSupported = typeof (MediaRecorder as any).isTypeSupported === "function";
    if (!isTypeSupported) return null;
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
  }, [isSafari]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const resetRecording = useCallback(() => {
    setRecordingTime(0);
    setRecordedBlob(null);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
  }, [recordedUrl]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      stopStream();

      if (!navigator?.mediaDevices?.getUserMedia) {
        setError("Браузер не поддерживает доступ к камере");
        setState("error");
        return;
      }

      // iOS Safari часто игнорирует facingMode. После получения разрешения
      // пытаемся выбрать нужную камеру по deviceId.
      let preferredDeviceId: string | null = null;
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        tmp.getTracks().forEach((t) => t.stop());
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === "videoinput");
        const re = facingMode === "user" ? /front|user|facetime/i : /back|rear|environment/i;
        preferredDeviceId = inputs.find((d) => re.test(d.label))?.deviceId ?? null;
      } catch {
        // ignore
      }

      const strictVideo: MediaTrackConstraints = preferredDeviceId
        ? {
            deviceId: { exact: preferredDeviceId },
            width: { ideal: 384 },
            height: { ideal: 384 },
            aspectRatio: { ideal: 1 },
          }
        : {
            facingMode: { ideal: facingMode },
            width: { ideal: 384 },
            height: { ideal: 384 },
            aspectRatio: { ideal: 1 },
          };

      const looseVideo: MediaTrackConstraints = preferredDeviceId
        ? { deviceId: { exact: preferredDeviceId } }
        : { facingMode: { ideal: facingMode } };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: strictVideo, audio: true });
      } catch (e: any) {
        if (e?.name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia({ video: looseVideo, audio: true });
        } else if (e?.name === "NotFoundError") {
          toast.message("Микрофон недоступен — запись будет без звука.");
          stream = await navigator.mediaDevices.getUserMedia({ video: strictVideo, audio: false });
        } else if (e?.name === "NotAllowedError") {
          // Часто это запрет именно на микрофон (особенно в iOS Safari) — пробуем без аудио.
          toast.message("Нет доступа к микрофону — запись будет без звука.");
          stream = await navigator.mediaDevices.getUserMedia({ video: strictVideo, audio: false });
        } else {
          throw e;
        }
      }

      // If browser/OS revokes camera later, show a recoverable error.
      const vTrack = stream.getVideoTracks()?.[0];
      if (vTrack) {
        setCameraLabel(vTrack.label || null);
        vTrack.onended = () => {
          stopStream();
          setError("Камера отключилась. Нажмите «Включить камеру» ещё раз.");
          setState("error");
        };
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Don't fail hard if autoplay is blocked (common on iOS)
        videoRef.current.play().catch(() => {
          /* ignore */
        });
      }

      setState("ready");
    } catch (e: any) {
      console.error("VideoNoteRecorder camera error", e);
      const msg =
        e?.name === "NotAllowedError"
          ? "Нет доступа к камере/микрофону. Разрешите доступ в настройках браузера."
          : e?.name === "NotReadableError"
            ? "Камера занята другим приложением. Закройте его и попробуйте снова."
            : "Не удалось получить доступ к камере.";
      setError(msg);
      setState("error");
    }
  }, [facingMode, stopStream]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;

    try {
      (mr as any).requestData?.();
    } catch {
      // ignore
    }

    try {
      mr.stop();
    } catch {
      // ignore
    }

    mediaRecorderRef.current = null;
    setState("preview");
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      toast.error("Запись видео не поддерживается этим браузером");
      return;
    }

    setDiagRecorderError(null);
    setDiagChunkBytes(0);
    setDiagChunkCount(0);
    setDiagRequestedMime(preferredMimeType);

    if (!streamRef.current) {
      await startCamera();
      // Даём время на инициализацию стрима
      await new Promise((r) => setTimeout(r, 300));
      if (!streamRef.current) return;
    }

    // Проверяем, что видео трек активен
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live") {
      toast.error("Камера не готова. Попробуйте ещё раз.");
      return;
    }

    resetRecording();
    chunksRef.current = [];

    const stream = streamRef.current;
    let mr: MediaRecorder;

    // Safari: создаём без mimeType (так стабильнее). Другие браузеры: пробуем preferredMimeType.
    try {
      if (!isSafari && preferredMimeType) mr = new MediaRecorder(stream, { mimeType: preferredMimeType });
      else mr = new MediaRecorder(stream);
    } catch {
      try {
        mr = new MediaRecorder(stream);
      } catch {
        try {
          if (preferredMimeType) mr = new MediaRecorder(stream, { mimeType: preferredMimeType });
          else throw new Error("no_mime");
        } catch (e) {
          console.error("VideoNoteRecorder MediaRecorder create error", e);
          toast.error("Не удалось начать запись");
          return;
        }
      }
    }

    mediaRecorderRef.current = mr;
    setDiagActualMime(mr.mimeType || null);

    mr.onstart = () => {
      setDiagActualMime(mr.mimeType || null);
      console.log("VideoNoteRecorder start", {
        requestedMime: preferredMimeType,
        actualMime: mr.mimeType,
        isSafari,
      });
    };

    mr.onerror = (ev: any) => {
      const err = ev?.error;
      const msg = err?.name ? `${err.name}: ${err.message ?? ""}`.trim() : "MediaRecorder error";
      setDiagRecorderError(msg);
      console.error("VideoNoteRecorder recorder error", err ?? ev);
    };

    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunksRef.current.push(ev.data);
        setDiagChunkCount((c) => c + 1);
        setDiagChunkBytes((b) => b + ev.data.size);
      }
    };

    mr.onstop = () => {
      const actualMime = mr.mimeType || preferredMimeType || "";
      const blob = actualMime
        ? new Blob(chunksRef.current, { type: actualMime })
        : new Blob(chunksRef.current);

      console.log("VideoNoteRecorder stop", {
        chunks: chunksRef.current.length,
        bytes: blob.size,
        actualMime,
      });

      if (!blob.size) {
        toast.error("Не удалось сохранить запись. Попробуйте ещё раз.");
        setState("ready");
        return;
      }

      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
    };

    // iOS Safari: используем timeslice для получения данных
    // Это критично для Safari — без timeslice данные часто не приходят
    try {
      mr.start(1000); // 1 секунда — работает стабильнее на iOS
    } catch {
      try {
        mr.start();
      } catch (e) {
        console.error("MediaRecorder.start failed", e);
        toast.error("Не удалось начать запись");
        return;
      }
    }

    // iOS Safari: периодически запрашиваем данные как fallback
    const dataTimer = window.setInterval(() => {
      try {
        if (mr.state === "recording") {
          (mr as any).requestData?.();
        }
      } catch {
        // ignore
      }
    }, 800);
    (mr as any)._dataTimer = dataTimer;

    setState("recording");

    const start = Date.now();
    const timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      setRecordingTime(sec);
      if (sec >= MAX_DURATION_SEC) {
        window.clearInterval(timer);
        stopRecording();
      }
    }, 250);

    (mr as any)._timer = timer;
  }, [isSafari, preferredMimeType, resetRecording, startCamera, stopRecording]);

  const handleStopRecordingClick = useCallback(() => {
    const mr = mediaRecorderRef.current as any;
    if (mr?._timer) window.clearInterval(mr._timer);
    if (mr?._dataTimer) window.clearInterval(mr._dataTimer);
    stopRecording();
  }, [stopRecording]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  const handleSend = useCallback(() => {
    if (!recordedBlob) return;

    const actualType = recordedBlob.type || "video/mp4";
    const ext = actualType.includes("webm") ? "webm" : actualType.includes("mp4") ? "mp4" : "mp4";

    const file = new File([recordedBlob], `video_note_${Date.now()}.${ext}`, {
      type: actualType,
    });

    onRecorded(file);
    onOpenChange(false);
  }, [onOpenChange, onRecorded, recordedBlob]);

  const handleRetry = useCallback(() => {
    resetRecording();
    setState("ready");
  }, [resetRecording]);

  // Manage lifecycle
  useEffect(() => {
    if (!open) return;

    setState("idle");
    setError(null);
    resetRecording();

    return () => {
      try {
        const mr = mediaRecorderRef.current as any;
        if (mr?._timer) window.clearInterval(mr._timer);
        if (mr?._dataTimer) window.clearInterval(mr._dataTimer);
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
      stopStream();
    };
  }, [open, resetRecording, stopStream]);

  // Restart camera when switching lens
  useEffect(() => {
    if (!open) return;
    if (state !== "ready") return;
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const showCamera = state === "ready" || state === "recording";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <div className="relative flex flex-col items-center justify-center p-4 min-h-[520px]">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-5 h-5" />
          </Button>

          <div className="flex flex-col items-center gap-4">
            {/* Preview */}
            <div className="relative">
              {showCamera && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-[280px] h-[280px] rounded-full border-4 border-primary object-cover bg-muted"
                  style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
                />
              )}

              {state === "preview" && recordedUrl && (
                <video
                  ref={previewVideoRef}
                  src={recordedUrl}
                  autoPlay
                  loop
                  playsInline
                  className="w-[280px] h-[280px] rounded-full border-4 border-primary object-cover bg-muted"
                />
              )}

              {(state === "idle" || state === "error") && (
                <div className="w-[280px] h-[280px] rounded-full border-4 border-border bg-muted flex items-center justify-center">
                  <div className="text-center px-6">
                    <p className="text-sm text-muted-foreground">
                      {error ?? "Для записи кружка нужен доступ к камере"}
                    </p>
                    <Button
                      className="mt-3"
                      onClick={() => startCamera()}
                      disabled={!navigator?.mediaDevices?.getUserMedia}
                    >
                      Включить камеру
                    </Button>
                  </div>
                </div>
              )}

              {/* timer */}
              {state === "recording" && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-destructive px-3 py-1 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-destructive-foreground animate-pulse" />
                  <span className="text-sm font-medium text-destructive-foreground">
                    {recordingTime}s
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={switchCamera}
                disabled={state === "recording" || state === "preview"}
                title="Переключить камеру"
              >
                <RefreshCw className="w-5 h-5" />
              </Button>

              {state !== "preview" ? (
                <button
                  type="button"
                  className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-colors ${
                    state === "recording"
                      ? "border-destructive bg-destructive"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                  onClick={state === "recording" ? handleStopRecordingClick : startRecording}
                  disabled={state === "idle" || state === "error"}
                >
                  {state === "recording" ? (
                    <div className="w-6 h-6 rounded-sm bg-destructive-foreground" />
                  ) : (
                    <Circle className="w-12 h-12 text-destructive fill-destructive" />
                  )}
                </button>
              ) : (
                <>
                  <Button variant="outline" onClick={handleRetry}>
                    Заново
                  </Button>
                  <Button className="gap-2" onClick={handleSend}>
                    <Send className="w-4 h-4" />
                    Отправить
                  </Button>
                </>
              )}

              <div className="w-10" />
            </div>

            {showCamera && cameraLabel && (
              <p className="text-[10px] text-muted-foreground/60 text-center truncate max-w-[280px]">
                {cameraLabel}
              </p>
            )}
            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              Удерживайте кнопку записи до 60 секунд.
            </p>

            {/* Диагностика (помогает понять, почему iOS Safari отдаёт пустой файл) */}
            <details className="w-full max-w-[360px]">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                Диагностика
              </summary>
              <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div>Запрошенный формат: {diagRequestedMime ?? "auto"}</div>
                <div>Фактический формат: {diagActualMime ?? "—"}</div>
                <div>Чанков: {diagChunkCount}</div>
                <div>Байт: {diagChunkBytes}</div>
                {diagRecorderError && <div className="text-destructive">Ошибка: {diagRecorderError}</div>}
              </div>
            </details>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
