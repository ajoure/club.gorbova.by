/**
 * Editor mode — displays template text with highlighted {{tokens}} as [UI Labels].
 * Phase 1: Only scalar tokens, no repeat blocks.
 */

import { useMemo } from "react";
import { getTokenLabel } from "@/lib/corporate/templateEditorMapper";
import { Button } from "@/components/ui/button";
import { Upload, RotateCcw } from "lucide-react";

interface EditorModeViewProps {
  rawText: string;
  onTextChange: (text: string) => void;
  onImportDocx: () => void;
  onResetFromDocx: () => void;
  hasExistingDraft: boolean;
}

export function EditorModeView({
  rawText,
  onTextChange,
  onImportDocx,
  onResetFromDocx,
  hasExistingDraft,
}: EditorModeViewProps) {
  /** Convert raw text to highlighted HTML for visual display */
  const highlightedHtml = useMemo(() => {
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

  if (!rawText) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="p-4 rounded-2xl bg-muted/40">
          <Upload className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Нет черновика</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Импортируйте DOCX из хранилища или загрузите файл, чтобы начать редактирование.
          </p>
        </div>
        <Button onClick={onImportDocx}>
          <Upload className="h-4 w-4 mr-2" />
          Импортировать из DOCX
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onResetFromDocx}>
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Сбросить и загрузить из DOCX
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700" />
          Плейсхолдер (распознан)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-700" />
          Плейсхолдер (не распознан)
        </div>
      </div>

      {/* Editor content */}
      <div
        className="min-h-[400px] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card p-4 sm:p-6 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />

      {/* Raw editor textarea for editing */}
      <details className="group">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
          Показать исходный текст (для редактирования)
        </summary>
        <textarea
          value={rawText}
          onChange={(e) => onTextChange(e.target.value)}
          className="mt-2 w-full min-h-[300px] rounded-xl border border-border bg-muted/30 p-4 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Текст шаблона с {{токенами}}..."
        />
      </details>
    </div>
  );
}
