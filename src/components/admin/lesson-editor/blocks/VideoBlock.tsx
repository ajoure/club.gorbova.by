import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VideoContent } from "@/hooks/useLessonBlocks";
import { Video, ExternalLink } from "lucide-react";

interface VideoBlockProps {
  content: VideoContent;
  onChange: (content: VideoContent) => void;
  isEditing?: boolean;
  /** Optional timecode in seconds for seeking (used in view mode) */
  timecodeSeconds?: number | null;
}

function detectVideoProvider(url: string): VideoContent['provider'] {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('vimeo.com')) return 'vimeo';
  if (url.includes('kinescope.io')) return 'kinescope';
  return 'other';
}

function getEmbedUrl(url: string, provider: VideoContent['provider'], timecodeSeconds?: number | null): string {
  if (!url) return '';
  
  let baseUrl = '';
  
  switch (provider) {
    case 'youtube': {
      const videoId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^?&]+)/)?.[1];
      baseUrl = videoId ? `https://www.youtube.com/embed/${videoId}` : url;
      // YouTube uses start= for embed
      if (timecodeSeconds && timecodeSeconds > 0) {
        baseUrl += `?start=${Math.floor(timecodeSeconds)}&autoplay=1`;
      }
      return baseUrl;
    }
    case 'vimeo': {
      const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      baseUrl = videoId ? `https://player.vimeo.com/video/${videoId}` : url;
      // Vimeo uses #t= format
      if (timecodeSeconds && timecodeSeconds > 0) {
        baseUrl += `#t=${Math.floor(timecodeSeconds)}s`;
      }
      return baseUrl;
    }
    case 'kinescope': {
      const videoId = url.match(/kinescope\.io\/(?:embed\/)?([a-zA-Z0-9]+)/)?.[1];
      baseUrl = videoId ? `https://kinescope.io/embed/${videoId}` : url;
      // Kinescope uses ?t= for timecode
      if (timecodeSeconds && timecodeSeconds > 0) {
        baseUrl += `?t=${Math.floor(timecodeSeconds)}`;
      }
      return baseUrl;
    }
    default:
      return url;
  }
}

export function VideoBlock({ content, onChange, isEditing = true, timecodeSeconds }: VideoBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localTitle, setLocalTitle] = useState(content.title || "");
  
  const handleUrlBlur = () => {
    const provider = detectVideoProvider(localUrl);
    onChange({ ...content, url: localUrl, provider });
  };

  const handleTitleBlur = () => {
    onChange({ ...content, title: localTitle });
  };

  const embedUrl = getEmbedUrl(content.url || "", content.provider, isEditing ? null : timecodeSeconds);

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }
    
    return (
      <div className="space-y-2">
        {content.title && (
          <p className="text-sm font-medium text-muted-foreground">{content.title}</p>
        )}
        <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
          <iframe
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
