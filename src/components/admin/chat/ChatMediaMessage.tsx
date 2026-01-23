import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  Image as ImageIcon, 
  Video, 
  Music, 
  Circle, 
  FileText, 
  Play,
  AlertCircle,
  RefreshCw,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Pause
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaLightbox } from "./MediaLightbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatMediaMessageProps {
  fileType: string | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType?: string | null;
  errorMessage?: string | null;
  isOutgoing: boolean;
  storageBucket?: string | null;
  storagePath?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
}

// Human-readable error messages
const ERROR_MESSAGES: Record<string, string> = {
  "mime_not_allowed": "Тип файла не разрешён",
  "size_limit": "Файл слишком большой",
  "telegram_download_failed": "Не удалось загрузить из Telegram",
  "storage_error": "Ошибка хранилища",
  "file_not_found": "Файл не найден",
  "MEDIA_UPLOAD_FAILED": "Загрузка не удалась",
};

// Helper to determine if file is PDF
const isPdfFile = (fileName: string | null, fileUrl: string | null): boolean => {
  if (fileName?.toLowerCase().endsWith('.pdf')) return true;
  if (fileUrl?.includes('application/pdf') || fileUrl?.includes('.pdf')) return true;
  return false;
};

export function ChatMediaMessage({
  fileType,
  fileUrl,
  fileName,
  mimeType,
  errorMessage,
  isOutgoing,
  storageBucket,
  storagePath,
  onRetry,
  onRefresh,
}: ChatMediaMessageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const hasFile = !!fileUrl && !imageError;
  
  // 3 media states: READY, CAN_ENRICH, NO_STORAGE
  const hasStorageRef = !!storageBucket && !!storagePath;
  type MediaState = 'READY' | 'CAN_ENRICH' | 'NO_STORAGE';
  const mediaState: MediaState = hasFile 
    ? 'READY' 
    : hasStorageRef 
      ? 'CAN_ENRICH' 
      : 'NO_STORAGE';

  // Derive canonical type from fileType, mimeType, or fileName
  const canonicalType: string | null = 
    // If fileType is already canonical, use it
    ["photo", "video", "video_note", "audio", "voice"].includes(fileType || "") 
      ? fileType 
    // Otherwise, derive from mimeType
    : mimeType?.startsWith("image/") 
      ? "photo"
    : mimeType?.startsWith("video/") 
      ? (fileType === "video_note" ? "video_note" : "video")
    : mimeType?.startsWith("audio/") 
      ? (fileType === "voice" ? "voice" : "audio")
    : mimeType === "application/pdf" 
      ? "document"
    // Fallback: try to guess from fileName extension
    : /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName || "")
      ? "photo"
    : /\.(mp4|mov|avi|webm|mkv)$/i.test(fileName || "")
      ? "video"
    : /\.(mp3|m4a|ogg|wav|opus|aac)$/i.test(fileName || "")
      ? "audio"
    : fileType;  // Last resort: use raw fileType

  const isPhoto = canonicalType === "photo";
  const isVideo = canonicalType === "video";
  const isVideoNote = canonicalType === "video_note";
  const isAudio = canonicalType === "audio" || canonicalType === "voice";
  const isDocument = !isPhoto && !isVideo && !isVideoNote && !isAudio;
  const isPdf = isDocument && isPdfFile(fileName, fileUrl);

  // Reset playing state when video note changes
  useEffect(() => {
    setIsPlaying(false);
  }, [fileUrl]);

  const getErrorMessage = () => {
    // Explicit error takes priority
    if (errorMessage) {
      return ERROR_MESSAGES[errorMessage] || errorMessage;
    }
    
    // State-based messages
    switch (mediaState) {
      case 'CAN_ENRICH':
        return "Файл загружается...";
      case 'NO_STORAGE':
        return isOutgoing 
          ? "Отправлено в Telegram" 
          : "Файл недоступен";
      default:
        return "Файл не загружен";
    }
  };

  const copyErrorToClipboard = () => {
    if (errorMessage) {
      navigator.clipboard.writeText(errorMessage);
    }
  };

  const handleVideoNoteClick = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Photo
  if (isPhoto) {
    if (hasFile) {
      return (
        <>
          <div 
            className="cursor-pointer hover:opacity-90 transition-opacity rounded overflow-hidden"
            onClick={() => setLightboxOpen(true)}
          >
            <img
              src={fileUrl}
              alt={fileName || "Photo"}
              className="max-w-full max-h-48 rounded object-cover"
              onError={() => setImageError(true)}
            />
          </div>
          <MediaLightbox
            open={lightboxOpen}
            onOpenChange={setLightboxOpen}
            type="photo"
            url={fileUrl}
            fileName={fileName}
          />
        </>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center p-4 bg-muted/30 border border-border/30 rounded-lg w-48 h-32">
        <ImageIcon className="w-8 h-8 opacity-40 mb-1" />
        <span className="text-xs text-muted-foreground text-center">{getErrorMessage()}</span>
        {mediaState === 'CAN_ENRICH' && onRefresh && (
          <Button variant="ghost" size="sm" className="h-6 mt-1" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Обновить
          </Button>
        )}
        {errorMessage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 mt-1" onClick={copyErrorToClipboard}>
                <Copy className="w-3 h-3 mr-1" />
                Копировать
              </Button>
            </TooltipTrigger>
            <TooltipContent>{errorMessage}</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  // Video Note (Кружок) - inline play like Telegram
  if (isVideoNote) {
    if (hasFile) {
      return (
        <>
          <div 
            className="relative w-48 h-48 rounded-full overflow-hidden cursor-pointer group"
            onClick={handleVideoNoteClick}
          >
            <video
              ref={videoRef}
              src={fileUrl}
              className="w-full h-full object-cover"
              loop
              playsInline
              muted={false}
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            />
            {/* Play/Pause overlay */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                  <Play className="w-6 h-6 text-white fill-white ml-1" />
                </div>
              </div>
            )}
            {/* Expand button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (videoRef.current) videoRef.current.pause();
                setIsPlaying(false);
                setLightboxOpen(true);
              }}
              className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Увеличить"
            >
              <Maximize2 className="w-3 h-3 text-white" />
            </button>
          </div>
          <MediaLightbox
            open={lightboxOpen}
            onOpenChange={setLightboxOpen}
            type="video_note"
            url={fileUrl}
            fileName={fileName}
          />
        </>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center bg-muted/30 border border-border/30 w-32 h-32 rounded-full">
        <Circle className="w-8 h-8 opacity-40 mb-1" />
        <span className="text-xs text-muted-foreground text-center px-2">
          {mediaState === 'CAN_ENRICH' && "Загрузка..."}
          {mediaState === 'NO_STORAGE' && (isOutgoing ? "Отправлено" : "Недоступен")}
          {errorMessage && getErrorMessage()}
        </span>
        {mediaState === 'CAN_ENRICH' && onRefresh && (
          <Button variant="ghost" size="sm" className="h-6 mt-1" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Обновить
          </Button>
        )}
        {errorMessage && onRetry && (
          <Button variant="ghost" size="sm" className="h-6 mt-1" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Повторить
          </Button>
        )}
      </div>
    );
  }

  // Video (regular)
  if (isVideo) {
    if (hasFile) {
      return (
        <>
          <div 
            className="relative cursor-pointer hover:opacity-90 transition-opacity max-w-full rounded overflow-hidden"
            onClick={() => setLightboxOpen(true)}
          >
            <video
              src={fileUrl}
              className="max-h-48 max-w-full rounded"
              muted
              preload="metadata"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                <Play className="w-6 h-6 text-white fill-white ml-1" />
              </div>
            </div>
          </div>
          <MediaLightbox
            open={lightboxOpen}
            onOpenChange={setLightboxOpen}
            type="video"
            url={fileUrl}
            fileName={fileName}
          />
        </>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center bg-muted/30 border border-border/30 w-48 h-32 rounded-lg">
        <Play className="w-8 h-8 opacity-40 mb-1" />
        <span className="text-xs text-muted-foreground text-center px-2">
          {mediaState === 'CAN_ENRICH' && "Загрузка видео..."}
          {mediaState === 'NO_STORAGE' && (isOutgoing ? "Отправлено" : "Видео недоступно")}
          {errorMessage && getErrorMessage()}
        </span>
        {mediaState === 'CAN_ENRICH' && onRefresh && (
          <Button variant="ghost" size="sm" className="h-6 mt-1" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Обновить
          </Button>
        )}
        {errorMessage && onRetry && (
          <Button variant="ghost" size="sm" className="h-6 mt-1" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Повторить
          </Button>
        )}
      </div>
    );
  }

  // Audio / Voice
  if (isAudio) {
    if (hasFile) {
      return (
        <audio
          src={fileUrl}
          controls
          className="w-full max-w-[250px]"
          controlsList="nodownload noplaybackrate"
        />
      );
    }

    return (
      <div className="flex items-center gap-2 p-3 bg-muted/30 border border-border/30 rounded-full w-fit">
        <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center">
          <Music className="w-4 h-4 opacity-40" />
        </div>
        <span className="text-xs text-muted-foreground">
          {mediaState === 'CAN_ENRICH' && "Загрузка..."}
          {mediaState === 'NO_STORAGE' && (isOutgoing ? "Отправлено" : (fileType === "voice" ? "Голосовое" : "Аудио"))}
          {errorMessage && getErrorMessage()}
        </span>
        {mediaState === 'CAN_ENRICH' && onRefresh && (
          <Button variant="ghost" size="sm" className="h-6" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
  }

  // Document (PDF or other) - always show Open/Download buttons
  if (hasFile) {
    const handleDownload = () => {
      const a = document.createElement("a");
      a.href = fileUrl!;
      a.download = fileName || "file";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    const handleOpenInNewTab = () => {
      window.open(fileUrl!, "_blank", "noopener,noreferrer");
    };

    return (
      <div className="flex flex-col gap-2 p-2 bg-background/20 rounded border border-border/30">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 shrink-0" />
          <span className="text-xs truncate max-w-[150px]">{fileName || "Файл"}</span>
          {isPdf && (
            <span className="text-[10px] text-muted-foreground uppercase">PDF</span>
          )}
        </div>
        <div className="flex gap-2">
          {isPdf ? (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 text-xs"
              onClick={() => setLightboxOpen(true)}
            >
              Открыть
            </Button>
          ) : (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 text-xs"
              onClick={handleOpenInNewTab}
            >
              Открыть
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 text-xs"
            onClick={handleDownload}
          >
            Скачать
          </Button>
        </div>
        {isPdf && (
          <MediaLightbox
            open={lightboxOpen}
            onOpenChange={setLightboxOpen}
            type="pdf"
            url={fileUrl}
            fileName={fileName}
          />
        )}
      </div>
    );
  }

  // Show upload error state with retry option
  const hasUploadError = !!errorMessage && !hasFile;
  
  return (
    <div className="flex flex-col gap-1 p-2 bg-muted/30 border border-border/30 rounded">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 opacity-40" />
        <span className="text-xs truncate max-w-[150px]">{fileName || "Файл"}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        {hasUploadError 
          ? `Ошибка: ${getErrorMessage()}` 
          : mediaState === 'CAN_ENRICH' 
            ? "Загрузка..." 
            : mediaState === 'NO_STORAGE' && isOutgoing 
              ? "Отправлено в Telegram" 
              : "Файл недоступен"}
      </span>
      <div className="flex gap-1">
        {mediaState === 'CAN_ENRICH' && onRefresh && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Обновить
          </Button>
        )}
        {hasUploadError && onRetry && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Повторить
          </Button>
        )}
      </div>
    </div>
  );
}
