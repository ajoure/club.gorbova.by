import { useState, useId, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { VideoContent } from "@/hooks/useLessonBlocks";
import { Video, ExternalLink, Play, AlertTriangle } from "lucide-react";
import { useKinescopePlayer, extractKinescopeVideoId } from "@/hooks/useKinescopePlayer";

interface VideoBlockProps {
  content: VideoContent;
  onChange: (content: VideoContent) => void;
  isEditing?: boolean;
  /** Active timecode in seconds for seeking (optional) */
  activeTimecode?: number | null;
  /** Nonce to force autoplay when timecode changes from user action */
  autoplayNonce?: number;
  /** Callback when seek was successfully applied */
  onSeekApplied?: (seconds: number, nonce: number) => void;
}

/**
 * Inject CSS for Kinescope player sizing into <head>
 * This avoids React DOM reconciliation issues with inline <style> tags
 */
function useKinescopeStyles(containerId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !containerId) return;

    const styleId = `kinescope-styles-${containerId}`;
    
    // Check if already exists
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${containerId} {
        width: 100% !important;
        height: 100% !important;
      }
      #${containerId} > div {
        width: 100% !important;
        height: 100% !important;
        position: absolute !important;
        inset: 0 !important;
      }
      #${containerId} iframe {
        width: 100% !important;
        height: 100% !important;
        position: absolute !important;
        inset: 0 !important;
        display: block !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existing = document.getElementById(styleId);
      if (existing) {
        existing.remove();
      }
    };
  }, [containerId, enabled]);
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
      // For Kinescope, we use the API player for controlled playback
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

export function VideoBlock({ 
  content, 
  onChange, 
  isEditing = true, 
  activeTimecode, 
  autoplayNonce,
  onSeekApplied 
}: VideoBlockProps) {
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
  
  // Callback for when seek is applied
  const handleSeekApplied = useCallback((seconds: number, nonce: number) => {
    console.info('[VideoBlock] Seek applied:', { seconds, nonce });
    onSeekApplied?.(seconds, nonce);
  }, [onSeekApplied]);
  
  // Use Kinescope API player for controlled playback
  const { autoplayBlocked, manualPlay } = useKinescopePlayer({
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
    onSeekApplied: handleSeekApplied,
  });

  // Fallback embed URL for non-API mode
  const embedUrl = getEmbedUrl(content.url || "", content.provider, isEditing ? undefined : activeTimecode);

  // Inject CSS into <head> for Kinescope player (avoids React DOM conflicts)
  const isKinescopeApiMode = content.provider === 'kinescope' && kinescopeVideoId && useApiPlayer && !apiError;
  useKinescopeStyles(containerId, isKinescopeApiMode && !isEditing);

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <Video className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }
    
    // Use Kinescope API player for controlled seek+autoplay
    if (isKinescopeApiMode) {
      return (
        <div className="space-y-2">
          {content.title && (
            <SafeHtml html={content.title} as="p" className="text-sm font-medium text-muted-foreground" />
          )}
          {/* Outer wrapper controls geometry (aspect-ratio) */}
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
            {/* React owns ONLY this wrapper. The Kinescope mount-point div is appended
                manually via useLayoutEffect below — so when Kinescope SDK mutates
                its children (or fails to load), React never tries to reconcile them
                and we avoid the "removeChild: node is not a child" crash that takes
                down the whole lesson page. */}
            <KinescopeMountPoint containerId={containerId} />
            {/* Autoplay blocked banner */}
            {autoplayBlocked && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-lg z-10">
                <div className="text-center text-white p-4">
                  <p className="text-sm mb-3">Автозапуск заблокирован браузером</p>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={manualPlay}
                    className="gap-2"
                  >
                    <Play className="h-5 w-5" />
                    Нажмите Play
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Fallback: API-плеер не смог запуститься (например, 402 от Kinescope).
    // Показываем обычный iframe — он отрендерит сообщение Kinescope, а не белый экран.
    if (content.provider === 'kinescope' && apiError && embedUrl) {
      return (
        <div className="space-y-2">
          {content.title && (
            <SafeHtml html={content.title} as="p" className="text-sm font-medium text-muted-foreground" />
          )}
          <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
            <iframe
              key={embedUrl}
              src={embedUrl}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
              allowFullScreen
            />
          </div>
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              Видео временно недоступно. Попробуйте обновить страницу или{" "}
              <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                открыть в новой вкладке
              </a>
              .
            </div>
          </div>
        </div>
      );
    }

    
    // Fallback to regular iframe
    return (
      <div className="space-y-2">
        {content.title && (
          <SafeHtml html={content.title} as="p" className="text-sm font-medium text-muted-foreground" />
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
        <RichTextarea
          value={localTitle}
          onChange={(html) => { setLocalTitle(html); onChange({ ...content, title: html }); }}
          placeholder="Название видео"
          inline
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

/**
 * KinescopeMountPoint — изолированный mount-point для Kinescope SDK.
 *
 * React контролирует только внешний wrapper-div. Внутренний div с нужным id
 * создаётся вручную через DOM API в useLayoutEffect и удаляется тем же способом
 * при размонтировании. Это разрывает контракт реконсиляции: Kinescope волен
 * добавлять/удалять любых детей у внутреннего div, React туда не заглядывает.
 *
 * Без этой развязки сбой Kinescope (например, HTTP 402) приводил к крэшу
 * `NotFoundError: Failed to execute 'removeChild' on 'Node'` в commit-фазе
 * React и уносил всю страницу урока в белый экран.
 */
function KinescopeMountPoint({ containerId }: { containerId: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const target = document.createElement('div');
    target.id = containerId;
    target.style.position = 'absolute';
    target.style.inset = '0';
    target.style.width = '100%';
    target.style.height = '100%';
    wrapper.appendChild(target);

    return () => {
      // Полностью очищаем поддерево вручную, ДО того как React размонтирует wrapper.
      // Это гарантирует, что React не столкнётся с "чужими" детьми, которые
      // Kinescope SDK мог добавить или подменить.
      try {
        while (wrapper.firstChild) {
          wrapper.removeChild(wrapper.firstChild);
        }
      } catch {
        /* ignore */
      }
    };
  }, [containerId]);

  return <div ref={wrapperRef} className="absolute inset-0" />;
}

