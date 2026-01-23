import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "photo" | "video" | "video_note";
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

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || `media.${isVideo ? "mp4" : "jpg"}`;
    a.target = "_blank";
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-[90vw] max-h-[90vh] p-0 border-none bg-black/95 overflow-hidden"
        onPointerDownOutside={() => onOpenChange(false)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        {/* Close button */}
        <div className="absolute top-2 right-2 z-50 flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={handleDownload}
            title="Скачать"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => window.open(url, "_blank")}
            title="Открыть в новой вкладке"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex items-center justify-center w-full h-full min-h-[300px] max-h-[85vh] p-4">
          {isVideo ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              className={cn(
                "max-w-full max-h-[80vh]",
                isVideoNote ? "rounded-full aspect-square object-cover" : "rounded-lg"
              )}
              style={isVideoNote ? { maxWidth: "min(80vw, 400px)", maxHeight: "min(80vh, 400px)" } : undefined}
            />
          ) : (
            <img
              src={url}
              alt={fileName || "Image"}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
