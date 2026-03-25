/**
 * Preview mode — two sub-modes:
 * 1. Raw preview: substitutes test data, downloadable as .txt
 * 2. Editor preview: highlights where tokens are (visual only, no download)
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applyTestData } from "@/lib/corporate/templateEditorTestData";
import { getTokenLabel } from "@/lib/corporate/templateEditorMapper";
import { Download, Eye, FileText } from "lucide-react";

type PreviewSubMode = "raw" | "editor";

interface PreviewModeViewProps {
  rawText: string;
}

export function PreviewModeView({ rawText }: PreviewModeViewProps) {
  const [subMode, setSubMode] = useState<PreviewSubMode>("raw");

  const rawPreviewText = useMemo(() => {
    if (!rawText) return "";
    return applyTestData(rawText);
  }, [rawText]);

  const editorPreviewHtml = useMemo(() => {
    if (!rawText) return "";
    return rawText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>")
      .replace(/\{\{([^}]+)\}\}/g, (match) => {
        const label = getTokenLabel(match);
        if (label) {
          return `<span class="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-sm font-medium border border-amber-200 dark:border-amber-700">[${label}]</span>`;
        }
        return `<span class="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm font-mono border border-red-200 dark:border-red-700">${match}</span>`;
      });
  }, [rawText]);

  const handleDownloadRawPreview = () => {
    const blob = new Blob([rawPreviewText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `preview_corp_order_meeting_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!rawText) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="p-4 rounded-2xl bg-muted/40">
          <Eye className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Сначала импортируйте DOCX в редактор
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={subMode === "raw" ? "default" : "outline"}
          size="sm"
          onClick={() => setSubMode("raw")}
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Тестовые данные
        </Button>
        <Button
          variant={subMode === "editor" ? "default" : "outline"}
          size="sm"
          onClick={() => setSubMode("editor")}
        >
          <Eye className="h-3.5 w-3.5 mr-1.5" />
          Подсветка полей
        </Button>

        {subMode === "raw" && (
          <Button variant="outline" size="sm" onClick={handleDownloadRawPreview} className="ml-auto">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Скачать .txt
          </Button>
        )}
      </div>

      {/* Info badges */}
      {subMode === "raw" && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Тестовый просмотр
          </Badge>
          <span className="text-xs text-muted-foreground">
            Все токены заменены тестовыми данными
          </span>
        </div>
      )}
      {subMode === "editor" && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700" />
            Плейсхолдер (распознан)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-700" />
            Не распознан
          </div>
        </div>
      )}

      {/* Preview content */}
      <div className="min-h-[400px] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card p-4 sm:p-6 text-sm leading-relaxed">
        {subMode === "raw" ? (
          <div className="whitespace-pre-wrap">{rawPreviewText}</div>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: editorPreviewHtml }} />
        )}
      </div>
    </div>
  );
}
