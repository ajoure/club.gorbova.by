import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { EmbedContent } from "@/hooks/useLessonBlocks";
import { Code, ExternalLink } from "lucide-react";

interface EmbedBlockProps {
  content: EmbedContent;
  onChange: (content: EmbedContent) => void;
  isEditing?: boolean;
}

export function EmbedBlock({ content, onChange, isEditing = true }: EmbedBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  
  const handleUrlBlur = () => {
    onChange({ ...content, url: localUrl });
  };

  const handleHeightChange = (value: number[]) => {
    onChange({ ...content, height: value[0] });
  };

  const height = content.height || 400;

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <Code className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }
    
    return (
      <div className="rounded-lg overflow-hidden border">
        <iframe
          src={content.url}
          className="w-full"
          style={{ height: `${height}px` }}
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>URL для встраивания</Label>
        <div className="flex gap-2">
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://docs.google.com/presentation/..."
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
        <Label>Высота: {height}px</Label>
        <Slider
          value={[height]}
          onValueChange={handleHeightChange}
          min={200}
          max={800}
          step={50}
        />
      </div>

      {content.url && (
        <div className="rounded-lg overflow-hidden border">
          <iframe
            src={content.url}
            className="w-full"
            style={{ height: `${height}px` }}
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
