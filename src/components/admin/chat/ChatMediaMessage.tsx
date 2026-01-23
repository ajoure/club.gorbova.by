import { useState } from "react";
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
  ExternalLink
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
  errorMessage?: string | null;
  isOutgoing: boolean;
  onRetry?: () => void;
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

export function ChatMediaMessage({
  fileType,
  fileUrl,
  fileName,
  errorMessage,
  isOutgoing,
  onRetry,
}: ChatMediaMessageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  const hasFile = !!fileUrl && !imageError;
  const isPhoto = fileType === "photo";
  const isVideo = fileType === "video";
  const isVideoNote = fileType === "video_note";
  const isAudio = fileType === "audio" || fileType === "voice";
  const isDocument = !isPhoto && !isVideo && !isVideoNote && !isAudio;

  const getErrorMessage = () => {
    if (!errorMessage) return "Файл не загружен";
    return ERROR_MESSAGES[errorMessage] || errorMessage;
  };

  const copyErrorToClipboard = () => {
    if (errorMessage) {
      navigator.clipboard.writeText(errorMessage);
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

  // Video / Video Note
  if (isVideo || isVideoNote) {
    if (hasFile) {
      return (
        <>
          <div 
            className={cn(
              "relative cursor-pointer hover:opacity-90 transition-opacity",
              isVideoNote ? "w-48 h-48 rounded-full overflow-hidden" : "max-w-full rounded overflow-hidden"
            )}
            onClick={() => setLightboxOpen(true)}
          >
            <video
              src={fileUrl}
              className={cn(
                "max-h-48",
                isVideoNote ? "w-full h-full object-cover" : "max-w-full rounded"
              )}
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
            type={isVideoNote ? "video_note" : "video"}
            url={fileUrl}
            fileName={fileName}
          />
        </>
      );
    }

    return (
      <div 
        className={cn(
          "flex flex-col items-center justify-center bg-muted/30 border border-border/30",
          isVideoNote ? "w-32 h-32 rounded-full" : "w-48 h-32 rounded-lg"
        )}
      >
        <Play className="w-8 h-8 opacity-40 mb-1" />
        <span className="text-xs text-muted-foreground text-center px-2">
          {isVideoNote ? "Кружок" : "Видео"} {getErrorMessage().toLowerCase()}
        </span>
        {onRetry && (
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
          {fileType === "voice" ? "Голосовое" : "Аудио"} {getErrorMessage().toLowerCase()}
        </span>
      </div>
    );
  }

  // Document
  if (hasFile) {
    return (
      <div className="flex items-center gap-2 p-2 bg-background/20 rounded">
        <FileText className="w-4 h-4" />
        <span className="text-xs truncate max-w-[150px]">{fileName || "Файл"}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => window.open(fileUrl, "_blank")}
        >
          <Download className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/30 border border-border/30 rounded">
      <FileText className="w-4 h-4 opacity-40" />
      <span className="text-xs truncate">{fileName || "Файл"}</span>
      <span className="text-xs text-muted-foreground">({getErrorMessage()})</span>
    </div>
  );
}
