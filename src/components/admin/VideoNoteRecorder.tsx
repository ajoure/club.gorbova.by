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

  const MAX_DURATION_SEC = 60;

  // Prefer MP4 for best Telegram compatibility
  const mimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4",
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
  }, []);

  const isSafari = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
  }, []);

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
    if (!mimeType) {
      toast.error("Запись видео не поддерживается этим браузером");
      return;
    }

    if (!streamRef.current) {
      await startCamera();
      if (!streamRef.current) return;
    }

    resetRecording();
    chunksRef.current = [];

    const stream = streamRef.current;
    let mr: MediaRecorder;

    try {
      mr = new MediaRecorder(stream, { mimeType });
    } catch {
      try {
        mr = new MediaRecorder(stream);
      } catch (e) {
        toast.error("Не удалось начать запись");
        return;
      }
    }

    mediaRecorderRef.current = mr;

    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    mr.onstop = () => {
      // Use the actual mimeType from recorder or fallback
      const actualMime = mr.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type: actualMime });

      if (!blob.size) {
        toast.error("Не удалось сохранить запись. Попробуйте ещё раз.");
        setState("ready");
        return;
      }

      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
    };

    try {
      if (isSafari) mr.start();
      else mr.start(500); // Collect data every 500ms for better compatibility
    } catch {
      mr.start();
    }
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
  }, [mimeType, resetRecording, startCamera, stopRecording]);

  const handleStopRecordingClick = useCallback(() => {
    const mr = mediaRecorderRef.current as any;
    if (mr?._timer) window.clearInterval(mr._timer);
    stopRecording();
  }, [stopRecording]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  const handleSend = useCallback(() => {
    if (!recordedBlob) return;

    // Determine extension based on actual blob type
    const isWebm = recordedBlob.type.includes("webm");
    const ext = isWebm ? "webm" : "mp4";
    const fileType = isWebm ? "video/webm" : "video/mp4";

    const file = new File([recordedBlob], `video_note_${Date.now()}.${ext}`, {
      type: fileType,
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
