import { useState, useId, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VideoContent } from "@/hooks/useLessonBlocks";
import { Video, ExternalLink, AlertCircle } from "lucide-react";
import { useKinescopePlayer, extractKinescopeVideoId } from "@/hooks/useKinescopePlayer";

interface VideoBlockProps {
  content: VideoContent;
  onChange: (content: VideoContent) => void;
  isEditing?: boolean;
  /** Active timecode in seconds for seeking (optional) */
  activeTimecode?: number | null;
  /** Nonce to force autoplay when timecode changes from user action */
  autoplayNonce?: number;
}

function detectVideoProvider(url: string): VideoContent['provider'] {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('vimeo.com')) return 'vimeo';
  if (url.includes('kinescope.io')) return 'kinescope';
  return 'other';
}

function getEmbedUrl(url: string, provider: VideoContent['provider'], timecode?: number | null): string {
  if (!url) return '';
  
  switch (provider) {
    case 'youtube': {
      const videoId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^?&]+)/)?.[1];
      let embedUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : url;
      if (timecode && timecode > 0) {
        embedUrl += `?start=${Math.floor(timecode)}&autoplay=1`;
      }
      return embedUrl;
    }
    case 'vimeo': {
      const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      let embedUrl = videoId ? `https://player.vimeo.com/video/${videoId}` : url;
      if (timecode && timecode > 0) {
        embedUrl += `?autoplay=1#t=${Math.floor(timecode)}s`;
      }
      return embedUrl;
    }
    case 'kinescope': {
      // For Kinescope, we'll use the API player for controlled playback
      // This is just a fallback URL if API fails
      const videoId = extractKinescopeVideoId(url);
      let embedUrl = videoId ? `https://kinescope.io/embed/${videoId}` : url;
      if (timecode && timecode > 0) {
        embedUrl += `?t=${Math.floor(timecode)}&autoplay=1`;
      }
      return embedUrl;
    }
    default:
      return url;
  }
}

export function VideoBlock({ content, onChange, isEditing = true, activeTimecode, autoplayNonce }: VideoBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localTitle, setLocalTitle] = useState(content.title || "");
  const [useApiPlayer, setUseApiPlayer] = useState(true);
  const [apiError, setApiError] = useState(false);
  
  // Unique container ID for Kinescope player
  const uniqueId = useId();
  const containerId = `kinescope-player-${uniqueId.replace(/:/g, '-')}`;
  
  const handleUrlBlur = () => {
    const provider = detectVideoProvider(localUrl);
    onChange({ ...content, url: localUrl, provider });
  };

  const handleTitleBlur = () => {
    onChange({ ...content, title: localTitle });
  };

  // Extract video ID for Kinescope
  const kinescopeVideoId = content.provider === 'kinescope' ? extractKinescopeVideoId(content.url || "") : null;
  
  // Use Kinescope API player for controlled playback
  const { seekAndPlay } = useKinescopePlayer({
    videoId: kinescopeVideoId || "",
    containerId,
    autoplayTimecode: activeTimecode,
    onReady: () => {
      setApiError(false);
    },
    onError: () => {
      setApiError(true);
      setUseApiPlayer(false);
    },
  });

  // Fallback embed URL for non-API mode
  const embedUrl = getEmbedUrl(content.url || "", content.provider, isEditing ? undefined : activeTimecode);

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }
    
    // Use Kinescope API player for controlled seek+autoplay
    if (content.provider === 'kinescope' && kinescopeVideoId && useApiPlayer && !apiError) {
      return (
        <div className="space-y-2">
          {content.title && (
            <p className="text-sm font-medium text-muted-foreground">{content.title}</p>
          )}
          <div 
            id={containerId}
            className="relative aspect-video rounded-lg overflow-hidden bg-black"
          />
        </div>
      );
    }
    
    // Fallback to regular iframe
    return (
      <div className="space-y-2">
        {content.title && (
          <p className="text-sm font-medium text-muted-foreground">{content.title}</p>
        )}
        <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
          <iframe
            key={embedUrl} // Force remount when URL changes (for autoplay)
            src={embedUrl}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>URL видео</Label>
        <div className="flex gap-2">
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://kinescope.io/... или YouTube/Vimeo"
            className="flex-1"
          />
          {content.url && (
            <a 
              href={content.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
      
      <div className="space-y-1.5">
        <Label>Название (опционально)</Label>
        <Input
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Название видео"
        />
      </div>

      {content.url && (
        <div className="aspect-video rounded-lg overflow-hidden bg-black">
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {content.provider && (
        <p className="text-xs text-muted-foreground">
          Определён как: {content.provider}
        </p>
      )}
    </div>
  );
}
