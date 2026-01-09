import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Circle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

interface VideoNoteRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (file: File) => void;
}

/**
 * State machine:
 * idle → ready → recording → preview → (send | reset → ready)
 * 
 * CRITICAL: preview state is PROTECTED - only user actions can exit it
 */
type RecorderState = "idle" | "ready" | "recording" | "preview" | "error";

export function VideoNoteRecorder({ open, onOpenChange, onRecorded }: VideoNoteRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  // Use ref for state to access current value in callbacks
  const stateRef = useRef<RecorderState>("idle");
  // Use ref to protect blob from being lost
  const recordedBlobRef = useRef<Blob | null>(null);

  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // diagnostics
  const [diagActualMime, setDiagActualMime] = useState<string | null>(null);
  const [diagChunkCount, setDiagChunkCount] = useState<number>(0);
  const [diagChunkBytes, setDiagChunkBytes] = useState<number>(0);
  const [diagRecorderError, setDiagRecorderError] = useState<string | null>(null);

  const MAX_DURATION_SEC = 60;

  // Sync state ref with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Visible + loggable version marker to ensure you test the latest build
  const VERSION = "2026-01-09.3";
  useEffect(() => {
    console.log("VideoNoteRecorder version", VERSION);
  }, []);

  const isSafari = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
  }, []);

  const preferredMimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") return null;
    // Safari: let browser choose format
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

  // Use ref to track recordedUrl for cleanup without causing re-renders
  const recordedUrlRef = useRef<string | null>(null);

  const resetRecording = useCallback(() => {
    setRecordingTime(0);
    recordedBlobRef.current = null;
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = null;
    }
    setRecordedUrl(null);
    setDiagChunkBytes(0);
    setDiagChunkCount(0);
    setDiagActualMime(null);
    setDiagRecorderError(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      stopStream();

      if (!navigator?.mediaDevices?.getUserMedia) {
        setError("Браузер не поддерживает доступ к камере");
        setState("error");
        return;
      }

      // Step 1: Request permission with any camera first (iOS workaround)
      let preferredDeviceId: string | null = null;
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        tmp.getTracks().forEach((t) => t.stop());
        
        // Step 2: Enumerate devices after permission granted
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === "videoinput");
        
        // Step 3: Find camera by label pattern
        const frontPattern = /front|user|facetime|передняя|фронт/i;
        const backPattern = /back|rear|environment|задняя/i;
        const targetPattern = facingMode === "user" ? frontPattern : backPattern;
        
        const targetCamera = inputs.find((d) => targetPattern.test(d.label));
        preferredDeviceId = targetCamera?.deviceId ?? null;
        
        console.log("VideoNoteRecorder cameras:", inputs.map(i => i.label), "selected:", targetCamera?.label);
      } catch {
        // Permission denied or other error - continue with fallback
      }

      // Step 4: Request stream with specific deviceId or facingMode
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
        } else if (e?.name === "NotFoundError" || e?.name === "NotAllowedError") {
          toast.message("Микрофон недоступен — запись будет без звука.");
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: strictVideo, audio: false });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: looseVideo, audio: false });
          }
        } else {
          throw e;
        }
      }

      const vTrack = stream.getVideoTracks()?.[0];
      if (vTrack) {
        setCameraLabel(vTrack.label || null);
        
        // CRITICAL: Camera disconnection should NOT reset preview/recording states
        vTrack.onended = () => {
          stopStream();
          // Only show error if in idle/ready - during recording/preview video is in blob
          if (stateRef.current === "idle" || stateRef.current === "ready") {
            setError("Камера отключилась. Нажмите «Включить камеру» ещё раз.");
            setState("error");
          }
          // Do nothing for recording/preview - data is already captured
        };
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      setState("ready");
    } catch (e: any) {
      console.error("VideoNoteRecorder camera error", e);
      const msg =
        e?.name === "NotAllowedError"
          ? "Нет доступа к камере/микрофону. Разрешите доступ в настройках браузера."
          : e?.name === "NotReadableError"
            ? "Камера занята другим приложением."
            : "Не удалось получить доступ к камере.";
      setError(msg);
      setState("error");
    }
  }, [facingMode, stopStream]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current as any;
    if (!mr) return;

    // Clear timers
    try {
      if (mr._timer) window.clearInterval(mr._timer);
      if (mr._dataTimer) window.clearInterval(mr._dataTimer);
    } catch {}

    // Request final data before stop (critical for iOS Safari)
    try {
      if (mr.state === "recording") {
        mr.requestData?.();
      }
    } catch {}

    // Small delay for iOS Safari to collect last chunk
    setTimeout(() => {
      try {
        if (mr.state === "recording") {
          mr.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }, 100);
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      toast.error("Запись видео не поддерживается этим браузером");
      return;
    }

    setDiagRecorderError(null);
    setDiagChunkBytes(0);
    setDiagChunkCount(0);

    // Ensure camera is ready
    if (!streamRef.current) {
      await startCamera();
      await new Promise((r) => setTimeout(r, 300));
      if (!streamRef.current) return;
    }

    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack || videoTrack.readyState !== "live") {
      toast.error("Камера не готова. Попробуйте ещё раз.");
      return;
    }

    resetRecording();
    chunksRef.current = [];

    const stream = streamRef.current;
    let mr: MediaRecorder;

    try {
      if (!isSafari && preferredMimeType) {
        mr = new MediaRecorder(stream, { mimeType: preferredMimeType });
      } else {
        mr = new MediaRecorder(stream);
      }
    } catch {
      try {
        mr = new MediaRecorder(stream);
      } catch (e) {
        console.error("MediaRecorder create error", e);
        toast.error("Не удалось начать запись");
        return;
      }
    }

    mediaRecorderRef.current = mr;
    setDiagActualMime(mr.mimeType || null);

    mr.onstart = () => {
      setDiagActualMime(mr.mimeType || null);
      console.log("VideoNoteRecorder start", { mime: mr.mimeType, isSafari });
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
      // iOS Safari: wait for final chunks
      setTimeout(() => {
        const actualMime = mr.mimeType || preferredMimeType || "";
        const blob = actualMime
          ? new Blob(chunksRef.current, { type: actualMime })
          : new Blob(chunksRef.current);

        console.log("VideoNoteRecorder stop", {
          chunks: chunksRef.current.length,
          bytes: blob.size,
          actualMime,
        });

        // Validate blob - must have content
        if (blob.size < 1000) {
          toast.error("Не удалось сохранить запись. Попробуйте ещё раз.");
          setState("ready");
          return;
        }

        // Save blob to ref (protected from state issues)
        recordedBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        recordedUrlRef.current = url;
        setRecordedUrl(url);
        
        // CRITICAL: Update stateRef BEFORE stopStream() 
        // so vTrack.onended sees "preview" and doesn't reset to error
        stateRef.current = "preview";
        setState("preview");
        
        // NOW safe to stop camera - onended will see stateRef === "preview"
        stopStream();
      }, 150);
    };

    // Start with timeslice for iOS Safari stability
    try {
      mr.start(1000);
    } catch {
      try {
        mr.start();
      } catch (e) {
        console.error("MediaRecorder.start failed", e);
        toast.error("Не удалось начать запись");
        return;
      }
    }

    // Periodic data request for iOS Safari
    const dataTimer = window.setInterval(() => {
      try {
        if (mr.state === "recording") {
          mr.requestData?.();
        }
      } catch {}
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
  }, [isSafari, preferredMimeType, resetRecording, startCamera, stopRecording, stopStream]);

  const handleStopRecordingClick = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  const handleSend = useCallback(() => {
    const blob = recordedBlobRef.current;
    if (!blob) {
      toast.error("Видео не найдено");
      return;
    }

    setIsSending(true);

    const actualType = blob.type || "video/mp4";
    const ext = actualType.includes("webm") ? "webm" : actualType.includes("mp4") ? "mp4" : "mp4";

    const file = new File([blob], `video_note_${Date.now()}.${ext}`, {
      type: actualType,
    });

    onRecorded(file);
    setIsSending(false);
    onOpenChange(false);
  }, [onOpenChange, onRecorded]);

  const handleRetry = useCallback(() => {
    resetRecording();
    startCamera();
  }, [resetRecording, startCamera]);

  // Lifecycle
  useEffect(() => {
    if (!open) return;

    setState("idle");
    stateRef.current = "idle";
    setError(null);
    resetRecording();

    return () => {
      try {
        const mr = mediaRecorderRef.current as any;
        if (mr?._timer) window.clearInterval(mr._timer);
        if (mr?._dataTimer) window.clearInterval(mr._dataTimer);
      } catch {}
      mediaRecorderRef.current = null;
      stopStream();
    };
  }, [open, resetRecording, stopStream]);

  // Auto-start camera when dialog opens
  useEffect(() => {
    if (open && state === "idle") {
      startCamera();
    }
  }, [open, state, startCamera]);

  // Restart camera when switching lens
  useEffect(() => {
    if (!open) return;
    if (state !== "ready" && state !== "error") return;
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const showCamera = state === "ready" || state === "recording";
  // Show preview as soon as state is preview, even if URL still loading
  const showPreview = state === "preview";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <div className="relative flex flex-col items-center justify-center p-4 min-h-[520px] pb-[env(safe-area-inset-bottom,16px)]">
          <DialogHeader className="w-full text-center">
            <DialogTitle>Запись кружка</DialogTitle>
            <DialogDescription>
              До 60 секунд. После остановки появятся кнопки отправки.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4">
            {/* Video display */}
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

              {showPreview && (
                recordedUrl ? (
                  <video
                    ref={previewVideoRef}
                    src={recordedUrl}
                    autoPlay
                    loop
                    playsInline
                    className="w-[280px] h-[280px] rounded-full border-4 border-primary object-cover bg-muted"
                  />
                ) : (
                  <div className="w-[280px] h-[280px] rounded-full border-4 border-primary bg-muted flex items-center justify-center">
                    <span className="text-sm text-muted-foreground">Обработка видео...</span>
                  </div>
                )
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

              {/* Timer during recording */}
              {state === "recording" && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-destructive px-3 py-1 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-destructive-foreground animate-pulse" />
                  <span className="text-sm font-medium text-destructive-foreground">
                    {recordingTime}s / {MAX_DURATION_SEC}s
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4 min-h-[64px]">
              {/* Camera switch - only when not in preview */}
              {state !== "preview" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={switchCamera}
                  disabled={state === "recording"}
                  title="Переключить камеру"
                >
                  <RefreshCw className="w-5 h-5" />
                </Button>
              )}

              {/* Recording / Preview controls */}
              {state !== "preview" ? (
                <>
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
                  <div className="w-10" />
                </>
              ) : (
                /* Preview state: ALWAYS show these buttons */
                <>
                  <Button variant="outline" onClick={handleRetry} disabled={isSending}>
                    Заново
                  </Button>
                  <Button className="gap-2" onClick={handleSend} disabled={isSending}>
                    <Send className="w-4 h-4" />
                    {isSending ? "Отправка..." : "Отправить"}
                  </Button>
                </>
              )}
            </div>

            {/* Camera label */}
            {showCamera && cameraLabel && (
              <p className="text-[10px] text-muted-foreground/60 text-center truncate max-w-[280px]">
                {cameraLabel}
              </p>
            )}

            {/* Instructions */}
            {state !== "preview" && (
              <p className="text-xs text-muted-foreground text-center max-w-[320px]">
                Нажмите кнопку записи. Максимум 60 секунд.
              </p>
            )}

            {state === "preview" && (
              <p className="text-xs text-muted-foreground text-center max-w-[320px]">
                Видео готово к отправке
              </p>
            )}

            {/* Diagnostics */}
            <details className="w-full max-w-[360px]">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                Диагностика
              </summary>
              <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div>Версия: {VERSION}</div>
                <div>Состояние: {state}</div>
                <div>Формат: {diagActualMime ?? "—"}</div>
                <div>Чанков: {diagChunkCount}</div>
                <div>Размер: {diagChunkBytes > 0 ? `${Math.round(diagChunkBytes / 1024)} KB` : "—"}</div>
                <div>Blob: {recordedBlobRef.current ? `${Math.round(recordedBlobRef.current.size / 1024)} KB` : "—"}</div>
                {diagRecorderError && <div className="text-destructive">Ошибка: {diagRecorderError}</div>}
              </div>
            </details>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
