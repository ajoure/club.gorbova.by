import { useState, useEffect, useRef, useCallback, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Video, CheckCircle2 } from "lucide-react";
import { extractKinescopeVideoId } from "@/hooks/useKinescopePlayer";

export interface VideoUnskippableContent {
  url: string;
  provider?: 'youtube' | 'vimeo' | 'kinescope' | 'other';
  title?: string;
  threshold_percent: number;
  required: boolean;
  duration_seconds?: number; // Kept in interface for backwards compat, unused
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

/**
 * PATCH P0.9.12: Simplified video block.
 * - No percent tracking, no fallback timers, no API detection.
 * - Just: show video + "I watched" confirmation button.
 * - Button press saves completion and unblocks the next block.
 */
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

  // Build embed URL
  const getEmbedUrl = useCallback((): string | null => {
    const url = content.url;
    if (!url) return null;

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s]+)/)?.[1];
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    
    if (url.includes('vimeo.com')) {
      const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      return videoId ? `https://player.vimeo.com/video/${videoId}` : null;
    }
    
    if (url.includes('kinescope.io')) {
      const videoId = extractKinescopeVideoId(url);
      if (videoId) {
        return `https://kinescope.io/embed/${videoId}`;
      }
      if (url.includes('/embed/')) {
        return url.split('?')[0];
      }
      const fallbackId = url.split('/').pop()?.split('?')[0];
      return fallbackId ? `https://kinescope.io/embed/${fallbackId}` : null;
    }
    
    return url;
  }, [content.url]);

  const embedUrl = getEmbedUrl();

  // Handle confirmation button click
  const handleConfirmWatched = () => {
    onProgress?.(100);
    onComplete?.();
  };

  // ─── EDITING MODE ───
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
        {content.url && embedUrl && (
          <div className="mt-4">
            <Label className="text-muted-foreground mb-2 block">Предпросмотр</Label>
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <iframe
                src={embedUrl}
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

  // ─── COMPLETED STATE ───
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

  // ─── PLAYER MODE (not completed) ───
  return (
    <div className="space-y-4">
      {content.title && (
        <h3 className="text-lg font-semibold">{content.title}</h3>
      )}

      {embedUrl ? (
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
          />
        </div>
      ) : (
        <Card className="py-12 text-center space-y-4">
          <Video className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Видео не настроено</p>
          
          {/* PATCH-V2: bypass for admin preview */}
          {allowBypassEmptyVideo && onComplete && (
            <Button onClick={onComplete} variant="outline" className="mt-4">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Продолжить без видео (админ)
            </Button>
          )}
          
          {!allowBypassEmptyVideo && (
            <p className="text-sm text-destructive mt-4">
              Видео не настроено. Обратитесь к администратору.
            </p>
          )}
        </Card>
      )}

      {/* P0.9.12: Simple confirmation button — no percent tracking */}
      {content.required !== false && (
        <div className="space-y-3">
          <Button
            onClick={handleConfirmWatched}
            className="w-full"
            size="lg"
          >
            <CheckCircle2 className="mr-2 h-5 w-5" />
            Я просмотрел(а) видео
          </Button>
          
          {/* Admin bypass */}
          {allowBypassEmptyVideo && (
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
        </div>
      )}
    </div>
  );
}
