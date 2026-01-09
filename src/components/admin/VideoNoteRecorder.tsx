import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Circle, RefreshCw, Send, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

interface VideoNoteRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (file: File) => void;
}

type RecorderState = "idle" | "loading_ffmpeg" | "ready" | "recording" | "processing" | "preview" | "error";

// Singleton FFmpeg instance
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) {
    return ffmpegInstance;
  }

  ffmpegInstance = new FFmpeg();
  
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  
  await ffmpegInstance.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  
  ffmpegLoaded = true;
  return ffmpegInstance;
}

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
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [progress, setProgress] = useState(0);

  const MAX_DURATION_SEC = 60;

  const mimeType = useMemo(() => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "video/webm;codecs=vp8,opus",
      "video/webm",
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4",
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
    setRecordedFile(null);
    setProgress(0);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
  }, [recordedUrl]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      stopStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 384 },
          height: { ideal: 384 },
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

  const convertToMp4 = useCallback(async (webmBlob: Blob): Promise<File> => {
    setState("processing");
    setProgress(10);

    try {
      const ffmpeg = await getFFmpeg();
      setProgress(30);

      // Write input file
      const inputData = await fetchFile(webmBlob);
      await ffmpeg.writeFile("input.webm", inputData);
      setProgress(40);

      // Convert to mp4 with square crop (for Telegram video_note)
      // -vf "crop=min(iw\,ih):min(iw\,ih),scale=384:384" crops to square, then scales
      await ffmpeg.exec([
        "-i", "input.webm",
        "-vf", "crop=min(iw\\,ih):min(iw\\,ih),scale=384:384",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "64k",
        "-movflags", "+faststart",
        "-y",
        "output.mp4"
      ]);
      setProgress(80);

      // Read output
      const data = await ffmpeg.readFile("output.mp4");
      setProgress(90);

      // Cleanup
      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp4");

      // Convert to Blob - handle both Uint8Array and string
      const uint8Data = data as Uint8Array;
      const mp4Blob = new Blob([uint8Data.slice().buffer], { type: "video/mp4" });
      const file = new File([mp4Blob], `video_note_${Date.now()}.mp4`, { type: "video/mp4" });
      
      setProgress(100);
      return file;
    } catch (err) {
      console.error("FFmpeg conversion error:", err);
      throw new Error("Не удалось конвертировать видео");
    }
  }, []);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;

    try {
      mr.stop();
    } catch {
      // ignore
    }

    mediaRecorderRef.current = null;
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

    mr.onstop = async () => {
      const blobType = mimeType ?? "video/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });

      // Convert to mp4 using FFmpeg
      try {
        const mp4File = await convertToMp4(blob);
        setRecordedFile(mp4File);
        setRecordedUrl(URL.createObjectURL(mp4File));
        setState("preview");
      } catch (err: any) {
        toast.error(err.message || "Ошибка обработки видео");
        setState("ready");
      }
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

    (mr as any)._timer = timer;
  }, [mimeType, resetRecording, startCamera, stopRecording, convertToMp4]);

  const handleStopRecordingClick = useCallback(() => {
    const mr = mediaRecorderRef.current as any;
    if (mr?._timer) window.clearInterval(mr._timer);
    stopRecording();
  }, [stopRecording]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  const handleSend = useCallback(() => {
    if (!recordedFile) return;
    onRecorded(recordedFile);
    onOpenChange(false);
  }, [onOpenChange, onRecorded, recordedFile]);

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
  const showProcessing = state === "processing" || state === "loading_ffmpeg";

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

              {showProcessing && (
                <div className="w-[280px] h-[280px] rounded-full border-4 border-primary bg-muted flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-primary" />
                  <div className="text-center px-6">
                    <p className="text-sm text-muted-foreground mb-2">
                      Обработка видео...
                    </p>
                    <Progress value={progress} className="w-32" />
                  </div>
                </div>
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
                disabled={state === "recording" || state === "preview" || showProcessing}
                title="Переключить камеру"
              >
                <RefreshCw className="w-5 h-5" />
              </Button>

              {state !== "preview" && !showProcessing ? (
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
              ) : state === "preview" ? (
                <>
                  <Button variant="outline" onClick={handleRetry}>
                    Заново
                  </Button>
                  <Button className="gap-2" onClick={handleSend}>
                    <Send className="w-4 h-4" />
                    Отправить
                  </Button>
                </>
              ) : null}

              <div className="w-10" />
            </div>

            <p className="text-xs text-muted-foreground text-center max-w-[320px]">
              Запись будет конвертирована в формат, совместимый с Telegram.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
