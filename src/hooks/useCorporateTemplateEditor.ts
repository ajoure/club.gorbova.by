/**
 * Hook for corporate template editor.
 * Handles DOCX import → draft parsing → save/load editor_draft_content.
 * 
 * IMPORTANT: editor_draft_content is staging only.
 * Runtime generation uses DOCX from storage, NOT this draft.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import mammoth from "mammoth";

export interface EditorDraft {
  /** Raw text extracted from DOCX (with canonical {{tokens}}) */
  rawText: string;
  /** Timestamp of last DOCX import */
  importedAt: string;
  /** Version marker */
  version: 1;
}

interface UseCorporateTemplateEditorReturn {
  draft: EditorDraft | null;
  isLoading: boolean;
  isSaving: boolean;
  importFromDocx: (templatePath: string) => Promise<void>;
  importFromFile: (file: File) => Promise<void>;
  saveDraft: (templateId: string, rawText: string) => Promise<void>;
  loadDraft: (templateId: string) => Promise<void>;
  resetDraft: (templateId: string, templatePath: string) => Promise<void>;
  setDraftText: (rawText: string) => void;
}

export function useCorporateTemplateEditor(): UseCorporateTemplateEditorReturn {
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const extractTextFromDocxBuffer = async (buffer: ArrayBuffer): Promise<string> => {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  };

  const importFromDocx = useCallback(async (templatePath: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("documents-templates")
        .download(templatePath);
      
      if (error) throw error;
      if (!data) throw new Error("Файл не найден");

      const buffer = await data.arrayBuffer();
      const rawText = await extractTextFromDocxBuffer(buffer);

      setDraft({
        rawText,
        importedAt: new Date().toISOString(),
        version: 1,
      });
      
      toast.success("DOCX импортирован в редактор");
    } catch (err) {
      console.error("DOCX import error:", err);
      toast.error("Ошибка импорта DOCX");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const importFromFile = useCallback(async (file: File) => {
    setIsLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const rawText = await extractTextFromDocxBuffer(buffer);

      setDraft({
        rawText,
        importedAt: new Date().toISOString(),
        version: 1,
      });

      toast.success("DOCX импортирован в редактор");
    } catch (err) {
      console.error("DOCX file import error:", err);
      toast.error("Ошибка чтения DOCX файла");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveDraft = useCallback(async (templateId: string, rawText: string) => {
    setIsSaving(true);
    try {
      const draftContent: EditorDraft = {
        rawText,
        importedAt: draft?.importedAt || new Date().toISOString(),
        version: 1,
      };

      const { error } = await supabase
        .from("document_templates")
        .update({
          editor_draft_content: draftContent as any,
          template_status: "draft",
        })
        .eq("id", templateId);

      if (error) throw error;

      setDraft(draftContent);
      toast.success("Черновик сохранён");
    } catch (err) {
      console.error("Save draft error:", err);
      toast.error("Ошибка сохранения черновика");
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  const loadDraft = useCallback(async (templateId: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("document_templates")
        .select("editor_draft_content")
        .eq("id", templateId)
        .single();

      if (error) throw error;

      if (data?.editor_draft_content) {
        const content = data.editor_draft_content as unknown as EditorDraft;
        setDraft(content);
      } else {
        setDraft(null);
      }
    } catch (err) {
      console.error("Load draft error:", err);
      toast.error("Ошибка загрузки черновика");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const resetDraft = useCallback(async (templateId: string, templatePath: string) => {
    await importFromDocx(templatePath);
    // After importing, auto-save the new draft
    if (draft) {
      await saveDraft(templateId, draft.rawText);
    }
  }, [importFromDocx, draft, saveDraft]);

  const setDraftText = useCallback((rawText: string) => {
    setDraft((prev) => prev ? { ...prev, rawText } : { rawText, importedAt: new Date().toISOString(), version: 1 });
  }, []);

  return {
    draft,
    isLoading,
    isSaving,
    importFromDocx,
    importFromFile,
    saveDraft,
    loadDraft,
    resetDraft,
    setDraftText,
  };
}
