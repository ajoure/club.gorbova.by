import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Circle, X, Send, RefreshCw } from "lucide-react";

interface VideoNoteRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (file: File) => void;
}

export function VideoNoteRecorder({ open, onOpenChange, onRecorded }: VideoNoteRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const MAX_DURATION = 60; // 60 seconds max for video notes

  // Draw circular video on canvas
  const drawCircularFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(drawCircularFrame);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 384; // Circle size
    canvas.width = size;
    canvas.height = size;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Create circular clipping path
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Calculate crop to make video square (center crop)
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const minDim = Math.min(vw, vh);
    const sx = (vw - minDim) / 2;
    const sy = (vh - minDim) / 2;

    // Draw the video centered and cropped to square
    ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, size, size);

    // Continue animation
    animationRef.current = requestAnimationFrame(drawCircularFrame);
  }, []);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setError(null);
      
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 640 },
          height: { ideal: 640 },
          aspectRatio: { ideal: 1 }
        },
        audio: true
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Start drawing circular frames
      animationRef.current = requestAnimationFrame(drawCircularFrame);
    } catch (err) {
      console.error("Camera access error:", err);
      setError("Не удалось получить доступ к камере");
    }
  }, [facingMode, drawCircularFrame]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Start recording
  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !streamRef.current) return;

    chunksRef.current = [];
    setRecordingTime(0);
    setRecordedBlob(null);
    setRecordedUrl(null);

    // Get audio track from the original stream
    const audioTracks = streamRef.current.getAudioTracks();
    
    // Create a new stream from canvas with audio
    const canvasStream = canvas.captureStream(30);
    if (audioTracks.length > 0) {
      canvasStream.addTrack(audioTracks[0]);
    }

    const options = { mimeType: "video/webm;codecs=vp8,opus" };
    let mediaRecorder: MediaRecorder;
    
    try {
      mediaRecorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
      // Fallback to default codec
      mediaRecorder = new MediaRecorder(canvasStream);
    }

    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
    };

    mediaRecorder.start(100);
    setIsRecording(true);

    // Timer
    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setRecordingTime(elapsed);
      
      if (elapsed >= MAX_DURATION) {
        stopRecording();
        clearInterval(timerInterval);
      }
    }, 100);

    // Store interval for cleanup
    (mediaRecorderRef.current as any)._timerInterval = timerInterval;
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      const timerInterval = (mediaRecorderRef.current as any)._timerInterval;
      if (timerInterval) clearInterval(timerInterval);
      
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  // Switch camera
  const switchCamera = useCallback(() => {
    setFacingMode(prev => prev === "user" ? "environment" : "user");
  }, []);

  // Handle send
  const handleSend = useCallback(() => {
    if (recordedBlob) {
      const file = new File([recordedBlob], `video_note_${Date.now()}.webm`, { type: "video/webm" });
      onRecorded(file);
      onOpenChange(false);
    }
  }, [recordedBlob, onRecorded, onOpenChange]);

  // Reset to record again
  const handleRetry = useCallback(() => {
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingTime(0);
  }, []);

  // Effects
  useEffect(() => {
    if (open && !recordedBlob) {
      startCamera();
    }
    return () => {
      if (!open) {
        stopCamera();
        setRecordedBlob(null);
        setRecordedUrl(null);
        setRecordingTime(0);
        setIsRecording(false);
      }
    };
  }, [open, startCamera, stopCamera, recordedBlob]);

  useEffect(() => {
    if (open && facingMode && !recordedBlob) {
      startCamera();
    }
  }, [facingMode, open, startCamera, recordedBlob]);

  // Cleanup URLs
  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
    };
  }, [recordedUrl]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-black border-none">
        <div className="relative flex flex-col items-center justify-center p-4 min-h-[500px]">
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-5 h-5" />
          </Button>

          {/* Error display */}
          {error && (
            <div className="text-red-500 text-center p-4">
              <p>{error}</p>
              <Button variant="outline" className="mt-2" onClick={startCamera}>
                Попробовать снова
              </Button>
            </div>
          )}

          {/* Video preview (hidden, used as source) */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="hidden"
          />

          {/* Circular canvas preview */}
          {!recordedBlob && !error && (
            <div className="relative">
              <canvas
                ref={canvasRef}
                className="rounded-full border-4 border-primary"
                style={{ width: 280, height: 280 }}
              />
              
              {/* Recording indicator */}
              {isRecording && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-red-500 px-3 py-1 rounded-full flex items-center gap-2">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  <span className="text-white text-sm font-medium">
                    {formatTime(recordingTime)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Recorded video preview */}
          {recordedBlob && recordedUrl && (
            <div className="relative">
              <video
                src={recordedUrl}
                autoPlay
                loop
                playsInline
                className="rounded-full border-4 border-primary object-cover"
                style={{ width: 280, height: 280 }}
              />
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 mt-6">
            {!recordedBlob ? (
              <>
                {/* Switch camera */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={switchCamera}
                  disabled={isRecording}
                >
                  <RefreshCw className="w-5 h-5" />
                </Button>

                {/* Record button */}
                <button
                  className={`w-16 h-16 rounded-full border-4 border-white flex items-center justify-center transition-all ${
                    isRecording ? "bg-red-500" : "bg-transparent hover:bg-white/10"
                  }`}
                  onClick={isRecording ? stopRecording : startRecording}
                >
                  {isRecording ? (
                    <div className="w-6 h-6 bg-white rounded-sm" />
                  ) : (
                    <Circle className="w-12 h-12 text-red-500 fill-red-500" />
                  )}
                </button>

                {/* Placeholder for symmetry */}
                <div className="w-10 h-10" />
              </>
            ) : (
              <>
                {/* Retry */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={handleRetry}
                >
                  <RefreshCw className="w-5 h-5" />
                </Button>

                {/* Send */}
                <Button
                  size="lg"
                  className="rounded-full w-16 h-16"
                  onClick={handleSend}
                >
                  <Send className="w-6 h-6" />
                </Button>

                {/* Placeholder for symmetry */}
                <div className="w-10 h-10" />
              </>
            )}
          </div>

          {/* Hint text */}
          <p className="text-white/60 text-sm mt-4 text-center">
            {isRecording 
              ? "Нажмите для остановки записи" 
              : recordedBlob 
                ? "Нажмите отправить или запишите заново"
                : "Нажмите для начала записи кружка"
            }
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
