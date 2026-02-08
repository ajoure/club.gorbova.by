import { useState, useEffect, useRef, useCallback, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Video, AlertTriangle, CheckCircle2, Play, Clock } from "lucide-react";
import { useKinescopePlayer, extractKinescopeVideoId } from "@/hooks/useKinescopePlayer";

export interface VideoUnskippableContent {
  url: string;
  provider?: 'youtube' | 'vimeo' | 'kinescope' | 'other';
  title?: string;
  threshold_percent: number;
  required: boolean;
  duration_seconds?: number; // Fallback: manual duration input
}

interface VideoUnskippableBlockProps {
  content: VideoUnskippableContent;
  onChange: (content: VideoUnskippableContent) => void;
  isEditing?: boolean;
  // Player mode props (kvest)
  watchedPercent?: number;
  onProgress?: (percent: number) => void;
  onComplete?: () => void;
  isCompleted?: boolean;
  /** PATCH-V2: Allow bypass when URL is empty (admin + preview only) */
  allowBypassEmptyVideo?: boolean;
}

export function VideoUnskippableBlock({ 
  content, 
  onChange, 
  isEditing = true,
  watchedPercent = 0,
  onProgress,
  onComplete,
  isCompleted = false,
  allowBypassEmptyVideo = false
}: VideoUnskippableBlockProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [localWatched, setLocalWatched] = useState(watchedPercent);
  // PATCH: Initialize videoStarted based on watchedPercent (for page reload case)
  const [videoStarted, setVideoStarted] = useState(watchedPercent > 0);
  const [fallbackTimer, setFallbackTimer] = useState<number | null>(null);
  const [fallbackElapsed, setFallbackElapsed] = useState(0);
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // PATCH-B/E: Track if Kinescope API is working (to disable fallback)
  const [apiWorking, setApiWorking] = useState(false);
  const [apiDetectionDone, setApiDetectionDone] = useState(false);
  const apiDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // PATCH-V1: Флаг включения Kinescope IframePlayer API (отключается при ошибке → fallback на iframe)
  const [kinescopeApiEnabled, setKinescopeApiEnabled] = useState(true);

  // Generate stable container ID for Kinescope player
  const kinescopeContainerId = useId().replace(/:/g, '-');
  
  // Extract Kinescope video ID from URL
  const isKinescope = content.provider === 'kinescope' || content.url?.includes('kinescope.io');
  const kinescopeVideoId = isKinescope ? extractKinescopeVideoId(content.url || "") : null;

  // Use Kinescope Player API hook for Kinescope videos (player mode only)
  // PATCH-V1: Added kinescopeApiEnabled - if API fails, we fall back to iframe embed
  const shouldUseKinescopeHook = isKinescope && kinescopeVideoId && !isEditing && !isCompleted && kinescopeApiEnabled;
  
  const kinescopePlayer = useKinescopePlayer({
    videoId: shouldUseKinescopeHook ? kinescopeVideoId : "",
    containerId: `kinescope-unskippable-${kinescopeContainerId}`,
    onReady: () => {
      if (shouldUseKinescopeHook) {
        console.info('[VideoUnskippableBlock] Kinescope API ready');
        setApiWorking(true);
        setApiDetectionDone(true);
        // Stop API detection timeout
        if (apiDetectionTimeoutRef.current) {
          clearTimeout(apiDetectionTimeoutRef.current);
          apiDetectionTimeoutRef.current = null;
        }
      }
    },
    onTimeUpdate: (currentTime, duration, percent) => {
      if (shouldUseKinescopeHook) {
        console.info('[VideoUnskippableBlock] Kinescope timeupdate:', { currentTime, duration, percent });
        setApiWorking(true);
        setVideoStarted(true);
        setLocalWatched(prev => Math.max(prev, percent));
        onProgress?.(percent);
        
        // Stop fallback timer if running
        if (fallbackIntervalRef.current) {
          clearInterval(fallbackIntervalRef.current);
          fallbackIntervalRef.current = null;
          setFallbackTimer(null);
        }
      }
    },
    onPlay: () => {
      if (shouldUseKinescopeHook) {
        console.info('[VideoUnskippableBlock] Kinescope play event');
        setApiWorking(true);
        setVideoStarted(true);
      }
    },
    onEnded: () => {
      if (shouldUseKinescopeHook) {
        console.info('[VideoUnskippableBlock] Kinescope ended event');
        setLocalWatched(100);
        onProgress?.(100);
      }
    },
    onError: (error) => {
      if (shouldUseKinescopeHook) {
        console.error('[VideoUnskippableBlock] Kinescope IframePlayer API error:', error);
        // PATCH-V1: При ошибке API — переключаемся на iframe embed с fallback таймером
        console.warn('[VideoUnskippableBlock] Falling back to iframe embed mode');
        setKinescopeApiEnabled(false);
        setApiDetectionDone(true);
      }
    }
  });

  const threshold = content.threshold_percent || 95;
  const isThresholdReached = localWatched >= threshold;
  const canConfirm = isThresholdReached && videoStarted;

  // Sync with external watchedPercent (from state)
  useEffect(() => {
    if (watchedPercent > localWatched) {
      setLocalWatched(watchedPercent);
    }
    if (watchedPercent >= threshold) {
      setVideoStarted(true);
    }
  }, [watchedPercent, threshold, localWatched]);

  // Auto-detect provider from URL
  const detectProvider = (url: string): 'youtube' | 'vimeo' | 'kinescope' | 'other' => {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('vimeo.com')) return 'vimeo';
    if (url.includes('kinescope.io')) return 'kinescope';
    return 'other';
  };

  const handleUrlChange = (url: string) => {
    onChange({
      ...content,
      url,
      provider: detectProvider(url)
    });
  };

  // Build embed URL with API enabled
  const getEmbedUrl = useCallback((): string | null => {
    const url = content.url;
    if (!url) return null;

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s]+)/)?.[1];
      return videoId ? `https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${window.location.origin}` : null;
    }
    
    if (url.includes('vimeo.com')) {
      const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      return videoId ? `https://player.vimeo.com/video/${videoId}?api=1` : null;
    }
    
    if (url.includes('kinescope.io')) {
      // PATCH-V1: Используем extractKinescopeVideoId для надёжного парсинга URL (учитывает ?t= и др.)
      const videoId = extractKinescopeVideoId(url);
      if (videoId) {
        return `https://kinescope.io/embed/${videoId}?autoplay=0`;
      }
      // Fallback: если extractKinescopeVideoId не распарсил, используем старую логику
      if (url.includes('/embed/')) {
        return url.includes('?') ? url : `${url}?autoplay=0`;
      }
      const fallbackId = url.split('/').pop()?.split('?')[0];
      return fallbackId ? `https://kinescope.io/embed/${fallbackId}?autoplay=0` : null;
    }
    
    return url;
  }, [content.url]);

  // PATCH-B: Жёсткие домены Kinescope для postMessage security
  const KINESCOPE_ORIGINS = [
    'https://kinescope.io',
    'https://player.kinescope.io',
  ];
  
  // PATCH-B: Белый список событий Kinescope
  const ALLOWED_EVENTS = [
    'player:timeupdate', 'player:ended', 'player:play', 'player:pause',
    'timeupdate', 'ended', 'play', 'pause'
  ];

  // Kinescope Player API integration via postMessage (legacy - kept for non-IframePlayer fallback)
  // When using IframePlayer API (shouldUseKinescopeHook=true), this listener won't receive events
  useEffect(() => {
    if (isEditing || isCompleted || shouldUseKinescopeHook) return;

    const handleMessage = (event: MessageEvent) => {
      // PATCH-B: Проверка origin через host — kinescope.io или *.kinescope.io
      try {
        const url = new URL(event.origin);
        const host = url.host;
        const originValid = host === 'kinescope.io' || host.endsWith('.kinescope.io');
        if (!originValid) {
          return; // Игнорируем недоверенные источники
        }
      } catch {
        return; // Невалидный origin
      }
      
      // PATCH-B: Проверка source — сообщение должно быть от нашего iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return; // Сообщение не от нашего iframe
      }
      
      // Kinescope sends events via postMessage
      if (!event.data) return;
      
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        
        // PATCH-B: Проверка формата события
        const eventType = data.type || data.event;
        if (!eventType || typeof eventType !== 'string') {
          return; // Неверный формат
        }
        
        // PATCH-B: Белый список событий
        if (!ALLOWED_EVENTS.includes(eventType)) {
          return; // Неизвестное событие
        }
        
        // Kinescope event types
        if (eventType === 'player:timeupdate' || eventType === 'timeupdate') {
          // PATCH-E: Mark API as working + stop all timers
          setApiWorking(true);
          
          // Сбросить флаг детекции и её таймер
          setApiDetectionDone(false);
          if (apiDetectionTimeoutRef.current) {
            clearTimeout(apiDetectionTimeoutRef.current);
            apiDetectionTimeoutRef.current = null;
          }
          
          // Остановить fallback таймер если был запущен
          if (fallbackIntervalRef.current) {
            clearInterval(fallbackIntervalRef.current);
            fallbackIntervalRef.current = null;
            setFallbackTimer(null);
          }
          
          const currentTime = data.data?.currentTime ?? data.currentTime ?? 0;
          const duration = data.data?.duration ?? data.duration ?? 0;
          
          if (duration > 0) {
            const percent = Math.round((currentTime / duration) * 100);
            setLocalWatched(prev => Math.max(prev, percent));
            setVideoStarted(true);
            onProgress?.(percent);
          }
        }
        
        if (eventType === 'player:ended' || eventType === 'ended') {
          setApiWorking(true);
          setLocalWatched(100);
          setVideoStarted(true);
          onProgress?.(100);
        }
        
        if (eventType === 'player:play' || eventType === 'play') {
          setApiWorking(true);
          setVideoStarted(true);
        }
      } catch {
        // Not a JSON message, ignore
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isEditing, isCompleted, shouldUseKinescopeHook, onProgress]);
  
  // PATCH-E: Вычислить embedUrl до эффекта (стабильное значение для deps)
  const embedUrl = getEmbedUrl();
  
  // PATCH-E: Автодетекция API — 5 сек ожидания, потом показываем fallback
  // Skip for Kinescope IframePlayer API - it reports ready/error via hook callbacks
  useEffect(() => {
    if (isEditing || isCompleted || apiWorking || shouldUseKinescopeHook) return;
    
    if (embedUrl && content.duration_seconds) {
      apiDetectionTimeoutRef.current = setTimeout(() => {
        if (!apiWorking) {
          setApiDetectionDone(true); // API не ответил за 3 сек
        }
      }, 3000); // PATCH: Уменьшено с 5000 до 3000 мс для быстрого fallback
    }
    
    return () => {
      if (apiDetectionTimeoutRef.current) {
        clearTimeout(apiDetectionTimeoutRef.current);
      }
    };
  }, [isEditing, isCompleted, apiWorking, embedUrl, content.duration_seconds, shouldUseKinescopeHook]);

  // Fallback timer when Kinescope API doesn't work
  const startFallbackTimer = useCallback(() => {
    const duration = content.duration_seconds;
    if (!duration || duration <= 0) return;
    
    setFallbackTimer(duration);
    setFallbackElapsed(0);
    setVideoStarted(true);
    
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
    }
    
    fallbackIntervalRef.current = setInterval(() => {
      setFallbackElapsed(prev => {
        const next = prev + 1;
        const percent = Math.round((next / duration) * 100);
        setLocalWatched(p => Math.max(p, percent));
        onProgress?.(percent);
        
        if (next >= duration) {
          if (fallbackIntervalRef.current) {
            clearInterval(fallbackIntervalRef.current);
          }
          return duration;
        }
        return next;
      });
    }, 1000);
  }, [content.duration_seconds, onProgress]);

  // Cleanup fallback timer
  useEffect(() => {
    return () => {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
      }
    };
  }, []);

  // Handle confirmation button click
  const handleConfirmWatched = () => {
    onComplete?.();
  };

  // Format seconds to mm:ss
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>URL видео *</Label>
          <Input
            value={content.url || ''}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://kinescope.io/... или YouTube/Vimeo URL"
          />
          <p className="text-xs text-muted-foreground">
            Поддерживаются: YouTube, Vimeo, Kinescope
          </p>
        </div>

        <div className="space-y-2">
          <Label>Название (необязательно)</Label>
          <Input
            value={content.title || ''}
            onChange={(e) => onChange({ ...content, title: e.target.value })}
            placeholder="Введение в модуль"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Провайдер</Label>
            <Select
              value={content.provider || 'kinescope'}
              onValueChange={(v) => onChange({ ...content, provider: v as any })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kinescope">Kinescope</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="vimeo">Vimeo</SelectItem>
                <SelectItem value="other">Другой</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Порог просмотра: {content.threshold_percent || 95}%</Label>
            <Slider
              value={[content.threshold_percent || 95]}
              onValueChange={([v]) => onChange({ ...content, threshold_percent: v })}
              min={50}
              max={100}
              step={5}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Длительность видео (секунды) — fallback</Label>
          <Input
            type="number"
            value={content.duration_seconds || ''}
            onChange={(e) => onChange({ ...content, duration_seconds: Number(e.target.value) || undefined })}
            placeholder="300 (5 минут)"
          />
          <p className="text-xs text-muted-foreground">
            Если API плеера недоступен, кнопка активируется через указанное время после старта просмотра
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="video-required"
            checked={content.required !== false}
            onCheckedChange={(checked) => onChange({ ...content, required: checked })}
          />
          <Label htmlFor="video-required">Обязательно для продолжения</Label>
        </div>

        {/* Preview */}
        {content.url && getEmbedUrl() && (
          <div className="mt-4">
            <Label className="text-muted-foreground mb-2 block">Предпросмотр</Label>
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <iframe
                src={getEmbedUrl()!}
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Player mode (student view) - embedUrl already computed above

  // Already completed - show simple confirmation
  if (isCompleted) {
    return (
      <div className="space-y-4">
        {content.title && (
          <h3 className="text-lg font-semibold">{content.title}</h3>
        )}
        
        {embedUrl && (
          <div className="aspect-video bg-black rounded-lg overflow-hidden opacity-70">
            <iframe
              src={embedUrl}
              className="w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
            />
          </div>
        )}
        
        <div className="flex items-center justify-center gap-2 py-3 bg-primary/10 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <span className="text-primary font-medium">Видео просмотрено</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {content.title && (
        <h3 className="text-lg font-semibold">{content.title}</h3>
      )}

      {(embedUrl || shouldUseKinescopeHook) ? (
        <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
          {/* For Kinescope: use div container for IframePlayer API */}
          {shouldUseKinescopeHook ? (
            <div 
              id={`kinescope-unskippable-${kinescopeContainerId}`}
              className="w-full h-full absolute inset-0"
              style={{ position: 'relative' }}
            />
          ) : (
            /* For YouTube/Vimeo: use standard iframe with postMessage */
            <iframe
              ref={iframeRef}
              src={embedUrl!}
              className="w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
            />
          )}
          
          {/* PATCH-V1: Overlay for starting fallback timer - shown when:
              - Video not started yet
              - duration_seconds is configured
              - API is not working (no timeupdate events received)
              - API detection is done (3s timeout passed)
              - NOT using Kinescope IframePlayer hook (it handles progress internally)
              OR when kinescopeApiEnabled was disabled (fallback to iframe) */}
          {!videoStarted && content.duration_seconds && !apiWorking && apiDetectionDone && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Button
                variant="secondary"
                size="lg"
                onClick={startFallbackTimer}
                className="gap-2"
              >
                <Play className="h-5 w-5" />
                Начать просмотр
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card className="py-12 text-center space-y-4">
          <Video className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Видео не настроено</p>
          
          {/* PATCH-V2: Кнопка продолжения ТОЛЬКО для admin + preview */}
          {allowBypassEmptyVideo && onComplete && !isCompleted && (
            <Button onClick={onComplete} variant="outline" className="mt-4">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Продолжить без видео (админ)
            </Button>
          )}
          
          {/* Обычный пользователь — заблокирован */}
          {!allowBypassEmptyVideo && !isCompleted && (
            <p className="text-sm text-destructive mt-4">
              Видео не настроено. Обратитесь к администратору.
            </p>
          )}
        </Card>
      )}

      {/* Progress indicator */}
      {content.required !== false && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              {isThresholdReached ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-primary">Просмотр завершён</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-muted-foreground">
                    Просмотрено: {Math.round(localWatched)}% из {threshold}% требуемых
                  </span>
                </>
              )}
            </span>
            <Badge variant={isThresholdReached ? "default" : "secondary"}>
              {isThresholdReached ? "✓ Готово" : `${Math.round(localWatched)}%`}
            </Badge>
          </div>
          
          <Progress 
            value={(localWatched / threshold) * 100} 
            className={`h-2 ${isThresholdReached ? '[&>div]:bg-primary' : ''}`}
          />

          {/* Fallback timer display */}
          {fallbackTimer && !isThresholdReached && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                {formatTime(fallbackElapsed)} / {formatTime(fallbackTimer)}
              </span>
            </div>
          )}

          {/* Confirmation button */}
          <Button
            onClick={handleConfirmWatched}
            disabled={!canConfirm}
            className="w-full"
            size="lg"
          >
            <CheckCircle2 className="mr-2 h-5 w-5" />
            Я просмотрел(а) видео
          </Button>
          
          {/* Admin bypass button - always visible in preview mode when not completed */}
          {allowBypassEmptyVideo && !isCompleted && (
            <Button
              onClick={handleConfirmWatched}
              variant="outline"
              className="w-full text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-600 dark:hover:bg-amber-900/20"
              size="sm"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Пропустить (админ preview)
            </Button>
          )}
          
          {!canConfirm && !allowBypassEmptyVideo && (
            <p className="text-center text-xs text-muted-foreground">
              {!videoStarted 
                ? "Запустите видео, чтобы активировать кнопку" 
                : "Досмотрите видео до конца, чтобы продолжить"
              }
            </p>
          )}
        </div>
      )}
    </div>
  );
}
