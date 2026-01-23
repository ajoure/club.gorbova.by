import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, RefreshCw, Image as ImageIcon, Video, Music, Circle, FileText, Play, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface OutboundMediaPreviewProps {
  file: File;
  fileType: "photo" | "video" | "audio" | "video_note" | "document" | null;
  isUploading?: boolean;
  error?: string | null;
  onRemove: () => void;
  onReplace?: () => void;
}

export function OutboundMediaPreview({
  file,
  fileType,
  isUploading = false,
  error = null,
  onRemove,
  onReplace,
}: OutboundMediaPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<string | null>(null);

  // Generate preview URL for images and videos
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  // Get video duration
  useEffect(() => {
    if (!previewUrl || !file.type.startsWith("video/")) return;

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const mins = Math.floor(video.duration / 60);
      const secs = Math.floor(video.duration % 60);
      setVideoDuration(`${mins}:${secs.toString().padStart(2, "0")}`);
      URL.revokeObjectURL(video.src);
    };
    video.src = previewUrl;
  }, [previewUrl, file]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileTypeIcon = () => {
    switch (fileType) {
      case "photo":
        return <ImageIcon className="w-4 h-4" />;
      case "video":
        return <Video className="w-4 h-4" />;
      case "audio":
        return <Music className="w-4 h-4" />;
      case "video_note":
        return <Circle className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getFileTypeLabel = () => {
    switch (fileType) {
      case "photo":
        return "Фото";
      case "video":
        return "Видео";
      case "audio":
        return "Аудио";
      case "video_note":
        return "Кружок";
      default:
        return "Документ";
    }
  };

  // Photo preview
  if (fileType === "photo" && previewUrl) {
    return (
      <div className="relative inline-block mb-2">
        <div className="relative rounded-lg overflow-hidden border border-border/50 bg-muted/30">
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-[200px] max-h-[150px] object-cover"
          />
          {isUploading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <RefreshCw className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
          )}
        </div>
        <div className="absolute -top-2 -right-2 flex gap-1">
          <Button
            variant="secondary"
            size="icon"
            className="h-6 w-6 rounded-full shadow-md"
            onClick={onRemove}
            disabled={isUploading}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </div>
    );
  }

  // Video/Video_note preview
  if ((fileType === "video" || fileType === "video_note") && previewUrl) {
    const isVideoNote = fileType === "video_note";
    return (
      <div className="relative inline-block mb-2">
        <div
          className={cn(
            "relative overflow-hidden border border-border/50 bg-muted/30",
            isVideoNote ? "rounded-full w-24 h-24" : "rounded-lg"
          )}
        >
          <video
            src={previewUrl}
            className={cn(
              isVideoNote
                ? "w-full h-full object-cover"
                : "max-w-[200px] max-h-[150px] object-cover"
            )}
            muted
          />
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            {isUploading ? (
              <RefreshCw className="w-6 h-6 text-white animate-spin" />
            ) : error ? (
              <AlertCircle className="w-6 h-6 text-red-500" />
            ) : (
              <Play className="w-8 h-8 text-white fill-white" />
            )}
          </div>
          {videoDuration && !isUploading && (
            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 rounded text-xs text-white">
              {videoDuration}
            </div>
          )}
        </div>
        <div className="absolute -top-2 -right-2 flex gap-1">
          <Button
            variant="secondary"
            size="icon"
            className="h-6 w-6 rounded-full shadow-md"
            onClick={onRemove}
            disabled={isUploading}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {isVideoNote && <Badge variant="secondary" className="text-xs h-5">Кружок</Badge>}
          <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </div>
    );
  }

  // Audio preview
  if (fileType === "audio") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg mb-2 max-w-[300px]">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          {isUploading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Music className="w-4 h-4 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={onRemove}
          disabled={isUploading}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  // Document/default preview
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg mb-2 max-w-[300px]">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
        {isUploading ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          getFileTypeIcon()
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {getFileTypeLabel()} • {formatFileSize(file.size)}
        </p>
        {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={onRemove}
        disabled={isUploading}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
