import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileContent } from "@/hooks/useLessonBlocks";
import { FileText, Download, ExternalLink } from "lucide-react";

interface FileBlockProps {
  content: FileContent;
  onChange: (content: FileContent) => void;
  isEditing?: boolean;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileBlock({ content, onChange, isEditing = true }: FileBlockProps) {
  const [localUrl, setLocalUrl] = useState(content.url || "");
  const [localName, setLocalName] = useState(content.name || "");
  const [localSize, setLocalSize] = useState(content.size?.toString() || "");
  
  const handleUrlBlur = () => {
    onChange({ ...content, url: localUrl });
  };

  const handleNameBlur = () => {
    onChange({ ...content, name: localName });
  };

  const handleSizeBlur = () => {
    onChange({ ...content, size: localSize ? parseInt(localSize) : undefined });
  };

  if (!isEditing) {
    if (!content.url) {
      return (
        <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <span className="text-muted-foreground">Файл не загружен</span>
        </div>
      );
    }
    
    return (
      <a
        href={content.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
      >
        <FileText className="h-8 w-8 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{content.name || "Файл"}</p>
          {content.size && (
            <p className="text-sm text-muted-foreground">{formatFileSize(content.size)}</p>
          )}
        </div>
        <Download className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
      </a>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>URL файла</Label>
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
      
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Название файла</Label>
          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameBlur}
            placeholder="document.pdf"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Размер (bytes)</Label>
          <Input
            type="number"
            value={localSize}
            onChange={(e) => setLocalSize(e.target.value)}
            onBlur={handleSizeBlur}
            placeholder="1024"
          />
        </div>
      </div>

      {content.url && content.name && (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
          <FileText className="h-6 w-6 text-primary" />
          <div className="flex-1">
            <p className="font-medium text-sm">{content.name}</p>
            {content.size && (
              <p className="text-xs text-muted-foreground">{formatFileSize(content.size)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
