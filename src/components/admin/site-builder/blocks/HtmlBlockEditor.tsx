/**
 * HtmlBlockEditor — site-builder domain editor for HTML blocks.
 *
 * Uses shared HtmlIframePreview for preview rendering.
 * Does NOT import from lesson domain — only shared infrastructure.
 *
 * Data mapping: site-builder stores HTML in `content.code`,
 * mapped to `html` prop for the shared preview component.
 */

import { useState, useRef, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, Edit, Upload } from "lucide-react";
import { HtmlIframePreview } from "@/components/shared/HtmlIframePreview";

interface HtmlBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
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

export function HtmlBlockEditor({ content, onChange }: HtmlBlockEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const html = (content.code as string) || "";

  const handleCodeChange = useCallback(
    (code: string) => {
      onChange({ ...content, code });
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
          handleCodeChange(parseHtmlFile(text));
        }
      };
      reader.readAsText(file, "utf-8");
      e.target.value = "";
    },
    [handleCodeChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">HTML-код</Label>
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
          <HtmlIframePreview html={html} />
        </div>
      ) : (
        <textarea
          className="w-full min-h-[200px] p-3 border rounded-lg font-mono text-xs bg-muted/30 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          value={html}
          onChange={(e) => handleCodeChange(e.target.value)}
          placeholder="<div>...</div>"
          spellCheck={false}
        />
      )}

      {html && (
        <p className="text-xs text-muted-foreground">
          {html.length.toLocaleString()} символов · Рендерится в изолированном iframe
        </p>
      )}
    </div>
  );
}
