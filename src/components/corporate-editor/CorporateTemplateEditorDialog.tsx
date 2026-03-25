/**
 * Corporate Template Editor Dialog — fullscreen editor for template drafts.
 * 
 * IMPORTANT: This editor creates staging drafts only.
 * Runtime document generation uses DOCX from storage, NOT editor drafts.
 * See S4-EDITOR-DRAFT-TO-DOCX-EXPORT for future export path.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EditorModeView } from "./EditorModeView";
import { PreviewModeView } from "./PreviewModeView";
import { useCorporateTemplateEditor } from "@/hooks/useCorporateTemplateEditor";
import {
  AlertTriangle,
  Pencil,
  Eye,
  Save,
  Loader2,
  Upload,
} from "lucide-react";

type EditorTab = "editor" | "preview";

interface CorporateTemplateEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  templatePath: string;
  templateStatus: string;
}

export function CorporateTemplateEditorDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  templatePath,
  templateStatus,
}: CorporateTemplateEditorDialogProps) {
  const [tab, setTab] = useState<EditorTab>("editor");
  const {
    draft,
    isLoading,
    isSaving,
    importFromDocx,
    importFromFile,
    saveDraft,
    loadDraft,
    setDraftText,
  } = useCorporateTemplateEditor();

  // Load existing draft on open
  useEffect(() => {
    if (open && templateId) {
      loadDraft(templateId);
    }
  }, [open, templateId, loadDraft]);

  const handleImportDocx = useCallback(async () => {
    await importFromDocx(templatePath);
  }, [importFromDocx, templatePath]);

  const handleResetFromDocx = useCallback(async () => {
    if (!confirm("Сбросить черновик и заново загрузить из DOCX? Текущие изменения будут потеряны.")) return;
    await importFromDocx(templatePath);
  }, [importFromDocx, templatePath]);

  const handleImportFile = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await importFromFile(file);
    };
    input.click();
  }, [importFromFile]);

  const handleSave = useCallback(async () => {
    if (!draft?.rawText) return;
    await saveDraft(templateId, draft.rawText);
  }, [draft, saveDraft, templateId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-lg">{templateName}</DialogTitle>
            <Badge
              variant="secondary"
              className="text-xs"
            >
              {templateStatus === "draft" ? "черновик" : templateStatus === "approved" ? "утверждён" : "в разработке"}
            </Badge>
          </div>
          <DialogDescription className="sr-only">
            Редактор черновика шаблона документа
          </DialogDescription>
        </DialogHeader>

        {/* Staging banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex-shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Это редактор черновика шаблона. Текущая runtime-генерация использует DOCX из хранилища.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant={tab === "editor" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("editor")}
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Редактор
          </Button>
          <Button
            variant={tab === "preview" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("preview")}
          >
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            Просмотр
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {tab === "editor" && !draft?.rawText && (
              <Button variant="outline" size="sm" onClick={handleImportFile}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Загрузить файл
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !draft?.rawText}
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Сохранить
            </Button>
          </div>
        </div>

        <Separator />

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "editor" ? (
            <EditorModeView
              rawText={draft?.rawText || ""}
              onTextChange={setDraftText}
              onImportDocx={handleImportDocx}
              onResetFromDocx={handleResetFromDocx}
              hasExistingDraft={!!draft}
            />
          ) : (
            <PreviewModeView rawText={draft?.rawText || ""} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
