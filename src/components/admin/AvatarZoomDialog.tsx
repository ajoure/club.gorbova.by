import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RefreshCw, Download, X, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

interface AvatarZoomDialogProps {
  avatarUrl: string | null;
  fallbackText: string;
  name?: string;
  onFetchFromTelegram?: () => void;
  isFetchingPhoto?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function AvatarZoomDialog({
  avatarUrl,
  fallbackText,
  name,
  onFetchFromTelegram,
  isFetchingPhoto,
  className,
  size = "md",
}: AvatarZoomDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10 sm:h-14 sm:w-14",
    lg: "h-16 w-16",
  };

  const handleDownload = async () => {
    if (!avatarUrl) return;
    
    try {
      const response = await fetch(avatarUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name || "avatar"}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Failed to download avatar:", error);
    }
  };

  return (
    <>
      <Avatar 
        className={cn(
          sizeClasses[size],
          "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
          className
        )}
        onClick={() => setIsOpen(true)}
      >
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name || ""} />}
        <AvatarFallback className="bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
          {fallbackText}
        </AvatarFallback>
      </Avatar>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-md p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-lg" style={{ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }}>
          <div className="relative" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute z-10 bg-background/80 hover:bg-background"
              style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))', right: 'calc(0.5rem + env(safe-area-inset-right, 0px))' }}
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>

            {/* Avatar image */}
            <div className="flex items-center justify-center p-8 bg-muted/30">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name || "Avatar"}
                  className="max-w-full max-h-[60vh] rounded-lg object-contain"
                />
              ) : (
                <div className="w-48 h-48 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                  <span className="text-6xl font-semibold text-primary">
                    {fallbackText}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-4 border-t flex items-center justify-center gap-2">
              {onFetchFromTelegram && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onFetchFromTelegram}
                  disabled={isFetchingPhoto}
                >
                  {isFetchingPhoto ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4 mr-2" />
                  )}
                  Загрузить из TG
                </Button>
              )}
              {avatarUrl && (
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Скачать
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}