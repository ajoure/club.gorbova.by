import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
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
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const MAX_DURATION_SEC = 60;

  const mimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
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

      // Always stop previous stream first (important on iOS Safari)
      stopStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          // iOS Safari ignores many constraints, but these help where possible
          width: { ideal: 720 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 1 },
        },
        audio: true,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setState("ready");
    } catch (e: any) {
      console.error("VideoNoteRecorder camera error", e);
      const msg =
        e?.name === "NotAllowedError"
          ? "Нет доступа к камере. Разрешите доступ в настройках браузера."
          : "Не удалось получить доступ к камере.";
      setError(msg);
      setState("error");
    }
  }, [facingMode, stopStream]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;

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
      // On iOS Safari permission works reliably only from a user gesture.
      // We call startCamera here so "Запись" also works as the gesture.
      await startCamera();
      if (!streamRef.current) return;
    }

    resetRecording();
    chunksRef.current = [];

    const stream = streamRef.current;
    const opts = mimeType ? { mimeType } : undefined;
    let mr: MediaRecorder;

    try {
      mr = new MediaRecorder(stream, opts as any);
    } catch {
      mr = new MediaRecorder(stream);
    }

    mediaRecorderRef.current = mr;

    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    mr.onstop = () => {
      const blobType = mimeType ?? "video/mp4";
      const blob = new Blob(chunksRef.current, { type: blobType });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
    };

    mr.start(250);
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

    // store timer for cleanup
    (mr as any)._timer = timer;
  }, [mimeType, resetRecording, startCamera, stopRecording]);

  const handleStopRecordingClick = useCallback(() => {
    const mr = mediaRecorderRef.current as any;
    if (mr?._timer) window.clearInterval(mr._timer);
    stopRecording();
  }, [stopRecording]);

  const switchCamera = useCallback(async () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  const handleSend = useCallback(() => {
    if (!recordedBlob) return;

    const ext = mimeType?.includes("mp4") ? "mp4" : "webm";
    const fileType = mimeType?.includes("mp4") ? "video/mp4" : "video/webm";

    const file = new File([recordedBlob], `video_note_${Date.now()}.${ext}`, {
      type: fileType,
    });

    onRecorded(file);
    onOpenChange(false);
  }, [mimeType, onOpenChange, onRecorded, recordedBlob]);

  // Manage lifecycle
  useEffect(() => {
    if (!open) return;

    // reset every open
    setState("idle");
    setError(null);
    resetRecording();

    return () => {
      // always release camera
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

  // Restart camera when switching lens (only if user already enabled camera)
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
                />
              )}

              {state === "preview" && recordedUrl && (
                <video
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
                >
                  {state === "recording" ? (
                    <div className="w-6 h-6 rounded-sm bg-destructive-foreground" />
                  ) : (
                    <Circle className="w-12 h-12 text-destructive fill-destructive" />
                  )}
                </button>
              ) : (
                <>
                  <Button variant="outline" onClick={resetRecording}>
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

            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              {mimeType?.includes("mp4")
                ? "Запись будет отправлена как кружок." 
                : "Ваш браузер может отправить кружок некорректно. Рекомендуется Chrome/Android или Safari iOS 17+."}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
