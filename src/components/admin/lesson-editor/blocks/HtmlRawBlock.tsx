import { useState, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, Edit, Upload } from "lucide-react";
import { HtmlIframePreview } from "@/components/shared/HtmlIframePreview";

export interface HtmlRawContentData {
  html: string;
  title?: string;
}

interface HtmlRawBlockProps {
  content: HtmlRawContentData;
  onChange: (content: HtmlRawContentData) => void;
  isEditing?: boolean;
}

/** Parse uploaded HTML file: extract <style> + <body> content */
function parseHtmlFile(raw: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "text/html");

    const styles = Array.from(doc.querySelectorAll("style"))
      .map((s) => s.outerHTML)
      .join("\n");

    const body = doc.body?.innerHTML?.trim() || raw;

    return styles ? `${styles}\n${body}` : body;
  } catch {
    return raw;
  }
}

export function HtmlRawBlock({ content, onChange, isEditing = true }: HtmlRawBlockProps) {
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleHtmlChange = useCallback(
    (html: string) => {
      onChange({ ...content, html });
    },
    [content, onChange],
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (text) {
          handleHtmlChange(parseHtmlFile(text));
        }
      };
      reader.readAsText(file, "utf-8");
      e.target.value = "";
    },
    [handleHtmlChange],
  );

  // Student / preview mode
  if (!isEditing) {
    return <HtmlIframePreview html={content.html || ""} />;
  }

  // Admin editing mode
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Название (опционально)</Label>
        <Input
          value={content.title || ""}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
          placeholder="Конспект урока"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label>HTML-код</Label>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Загрузить файл
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? (
              <>
                <Edit className="h-3.5 w-3.5 mr-1.5" />
                Редактор
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                Предпросмотр
              </>
            )}
          </Button>
        </div>
      </div>

      {showPreview ? (
        <div className="border rounded-lg overflow-hidden">
          <HtmlIframePreview html={content.html || ""} />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="w-full min-h-[300px] p-3 border rounded-lg font-mono text-sm bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          value={content.html || ""}
          onChange={(e) => handleHtmlChange(e.target.value)}
          placeholder="Вставьте HTML-код с CSS-стилями..."
          spellCheck={false}
        />
      )}

      {content.html && (
        <p className="text-xs text-muted-foreground">
          {content.html.length.toLocaleString()} символов · Рендерится в изолированном iframe
        </p>
      )}
    </div>
  );
}
