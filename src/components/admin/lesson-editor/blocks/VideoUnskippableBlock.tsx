import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Video, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface VideoUnskippableContent {
  url: string;
  provider?: 'youtube' | 'vimeo' | 'kinescope' | 'other';
  title?: string;
  threshold_percent: number;
  required: boolean;
}

interface VideoUnskippableBlockProps {
  content: VideoUnskippableContent;
  onChange: (content: VideoUnskippableContent) => void;
  isEditing?: boolean;
  // Player mode props
  watchedPercent?: number;
  onProgress?: (percent: number) => void;
}

export function VideoUnskippableBlock({ 
  content, 
  onChange, 
  isEditing = true,
  watchedPercent = 0,
  onProgress
}: VideoUnskippableBlockProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [localWatched, setLocalWatched] = useState(watchedPercent);

  const threshold = content.threshold_percent || 95;
  const isComplete = localWatched >= threshold;

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
  const getEmbedUrl = (): string | null => {
    const url = content.url;
    if (!url) return null;

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s]+)/)?.[1];
      return videoId ? `https://www.youtube.com/embed/${videoId}?enablejsapi=1` : null;
    }
    
    if (url.includes('vimeo.com')) {
      const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      return videoId ? `https://player.vimeo.com/video/${videoId}` : null;
    }
    
    if (url.includes('kinescope.io')) {
      if (url.includes('/embed/')) return url;
      const videoId = url.split('/').pop();
      return `https://kinescope.io/embed/${videoId}`;
    }
    
    return url;
  };

  // Simulated progress for demo (in production, integrate with player API)
  useEffect(() => {
    if (!isEditing && !isComplete) {
      // Demo: simulate gradual progress
      const interval = setInterval(() => {
        setLocalWatched(prev => {
          const next = Math.min(prev + 1, 100);
          if (onProgress) onProgress(next);
          return next;
        });
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [isEditing, isComplete, onProgress]);

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

  // Player mode
  const embedUrl = getEmbedUrl();

  return (
    <div className="space-y-4">
      {content.title && (
        <h3 className="text-lg font-semibold">{content.title}</h3>
      )}

      {embedUrl ? (
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
          />
        </div>
      ) : (
        <Card className="py-12 text-center">
          <Video className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Видео не настроено</p>
        </Card>
      )}

      {/* Progress indicator */}
      {content.required !== false && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              {isComplete ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-green-600">Просмотр завершён</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-muted-foreground">
                    Просмотрено: {Math.round(localWatched)}% из {threshold}% требуемых
                  </span>
                </>
              )}
            </span>
            <Badge variant={isComplete ? "default" : "secondary"}>
              {isComplete ? "✓ Готово" : `${Math.round(localWatched)}%`}
            </Badge>
          </div>
          <Progress 
            value={(localWatched / threshold) * 100} 
            className={`h-2 ${isComplete ? '[&>div]:bg-green-500' : ''}`}
          />
        </div>
      )}
    </div>
  );
}
