import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ImageContent } from "@/hooks/useLessonBlocks";
import { ImageIcon } from "lucide-react";

interface ImageBlockProps {
  content: ImageContent;
  onChange: (content: ImageContent) => void;
  isEditing?: boolean;
}

export function ImageBlock({ content, onChange, isEditing = true }: ImageBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localAlt, setLocalAlt] = useState(content.alt || "");
  
  const handleUrlBlur = () => {
    onChange({ ...content, url: localUrl });
  };

  const handleAltBlur = () => {
    onChange({ ...content, alt: localAlt });
  };

  const handleWidthChange = (value: number[]) => {
    onChange({ ...content, width: value[0] });
  };

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
          <ImageIcon className="h-12 w-12 text-muted-foreground" />
        </div>
      );
    }
    
    return (
      <div className="flex justify-center">
        <img
          src={content.url}
          alt={content.alt || ""}
          style={{ maxWidth: content.width ? `${content.width}%` : '100%' }}
          className="rounded-lg max-h-[600px] object-contain"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>URL изображения</Label>
        <Input
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://..."
        />
      </div>
      
      <div className="space-y-1.5">
        <Label>Alt текст</Label>
        <Input
          value={localAlt}
          onChange={(e) => setLocalAlt(e.target.value)}
          onBlur={handleAltBlur}
          placeholder="Описание изображения"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Ширина: {content.width || 100}%</Label>
        <Slider
          value={[content.width || 100]}
          onValueChange={handleWidthChange}
          min={25}
          max={100}
          step={5}
        />
      </div>

      {content.url && (
        <div className="flex justify-center p-4 bg-muted/30 rounded-lg">
          <img
            src={content.url}
            alt={content.alt || "Preview"}
            style={{ maxWidth: content.width ? `${content.width}%` : '100%' }}
            className="max-h-[300px] object-contain rounded"
          />
        </div>
      )}
    </div>
  );
}
