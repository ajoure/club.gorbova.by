import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AudioContent } from "@/hooks/useLessonBlocks";
import { Music, ExternalLink } from "lucide-react";

interface AudioBlockProps {
  content: AudioContent;
  onChange: (content: AudioContent) => void;
  isEditing?: boolean;
}

export function AudioBlock({ content, onChange, isEditing = true }: AudioBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localTitle, setLocalTitle] = useState(content.title || "");
  
  const handleUrlBlur = () => {
    onChange({ ...content, url: localUrl });
  };

  const handleTitleBlur = () => {
    onChange({ ...content, title: localTitle });
  };

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-20 bg-muted rounded-lg">
          <Music className="h-8 w-8 text-muted-foreground" />
        </div>
      );
    }
    
    return (
      <div className="space-y-2">
        {content.title && (
          <p className="text-sm font-medium text-muted-foreground">{content.title}</p>
        )}
        <audio controls className="w-full">
          <source src={content.url} />
          Ваш браузер не поддерживает аудио элемент.
        </audio>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>URL аудио</Label>
        <div className="flex gap-2">
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://..."
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
          placeholder="Название аудио"
        />
      </div>

      {content.url && (
        <audio controls className="w-full">
          <source src={content.url} />
        </audio>
      )}
    </div>
  );
}
