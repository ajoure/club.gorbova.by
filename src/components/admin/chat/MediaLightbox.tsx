import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download, ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "photo" | "video" | "video_note" | "pdf" | "document";
  url: string;
  fileName?: string | null;
}

export function MediaLightbox({
  open,
  onOpenChange,
  type,
  url,
  fileName,
}: MediaLightboxProps) {
  const isVideoNote = type === "video_note";
  const isVideo = type === "video" || isVideoNote;
  const isPdf = type === "pdf";
  const isDocument = type === "document";

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || `media.${isVideo ? "mp4" : isPdf ? "pdf" : "jpg"}`;
    a.target = "_blank";
    a.click();
  };

  const controlButtonClass = "h-8 w-8 text-foreground/80 hover:text-foreground hover:bg-muted";

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 border-none overflow-visible shadow-none bg-transparent",
          "!max-w-none !w-screen !h-screen !top-0 !left-0 !translate-x-0 !translate-y-0 !rounded-none",
          "flex items-center justify-center"
        )}
        showCloseButton={false}
        onEscapeKeyDown={() => onOpenChange(false)}
        onClick={handleBackdropClick}
      >
        <div
          className="inline-flex w-fit max-w-[92vw] flex-col items-end gap-2"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Controls */}
        <div className="z-50 flex items-center gap-1 rounded-full border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button
            variant="ghost"
            size="icon"
            className={controlButtonClass}
            onClick={handleDownload}
            title="Скачать"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={controlButtonClass}
            onClick={() => window.open(url, "_blank")}
            title="Открыть в новой вкладке"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={controlButtonClass}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className={cn(
          "flex items-center justify-center w-fit max-w-[92vw] overflow-hidden",
          isPdf || isDocument ? "min-h-[300px] max-h-[calc(90vh-3rem)] rounded-lg bg-background p-4" : "max-h-[calc(92vh-3rem)] p-0"
        )}>
          {isPdf ? (
            <iframe
              src={url}
              className="w-full h-[80vh] rounded-lg border border-border"
              title={fileName || "PDF Document"}
            />
          ) : isDocument ? (
            <div className="flex flex-col items-center gap-6 p-8">
              <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
                <FileText className="w-10 h-10 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium">{fileName || "Файл"}</p>
                <p className="text-sm text-muted-foreground mt-1">Предпросмотр недоступен для этого типа файла</p>
              </div>
              <div className="flex gap-3">
                <Button onClick={handleDownload}>
                  <Download className="w-4 h-4 mr-2" /> Скачать
                </Button>
                <Button variant="outline" onClick={() => window.open(url, "_blank")}>
                  <ExternalLink className="w-4 h-4 mr-2" /> Открыть в новой вкладке
                </Button>
              </div>
            </div>
          ) : isVideo ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              className={cn(
                "max-w-full max-h-[calc(92vh-3rem)]",
                isVideoNote ? "rounded-full aspect-square object-cover" : "rounded-lg"
              )}
              style={isVideoNote ? { maxWidth: "min(80vw, 400px)", maxHeight: "min(80vh, 400px)" } : undefined}
            />
          ) : (
            <img
              src={url}
              alt={fileName || "Image"}
              className="block max-w-[92vw] max-h-[calc(92vh-3rem)] object-contain rounded-lg bg-transparent"
            />
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
