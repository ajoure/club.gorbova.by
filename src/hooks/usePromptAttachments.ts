import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractTextFromFile, getFileType } from "@/utils/fileExtractor";
import { toast } from "sonner";



/**
 * Builds an ASCII-only safe file name for Supabase Storage keys.
 * Original file name is preserved in DB `file_name` column.
 * Format: {timestamp}_{uuid}.{ext}
 */
export function buildSafeStorageFileName(fileName: string): string {
  let ext = "";
  if (fileName.includes(".")) {
    const rawExt = fileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (rawExt) {
      ext = `.${rawExt}`;
    }
  }
  return `${Date.now()}_${crypto.randomUUID()}${ext}`;
}

export interface PromptAttachment {
  id: string;
  prompt_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  extracted_text: string | null;
  extracted_chars: number;
  extraction_status: "ready" | "empty" | "failed" | "truncated";
  sort_order: number;
  created_at: string;
}

export interface DeleteResult {
  storageDeleted: boolean;
  dbDeleted: boolean;
}

export function usePromptAttachments() {
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchAttachments = useCallback(async (promptId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ai_prompt_attachments")
        .select("*")
        .eq("prompt_id", promptId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to fetch attachments:", error);
        toast.error("Ошибка загрузки вложений");
        return;
      }
      setAttachments((data as PromptAttachment[]) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadAttachment = useCallback(async (promptId: string, file: File) => {
    setUploading(true);
    try {
      const fileType = getFileType(file);

      // Only allow word/excel/text for Phase 1
      if (!["word", "excel", "text"].includes(fileType)) {
        toast.error(`Тип файла "${fileType}" не поддерживается`);
        return null;
      }

      // 1. Extract text using existing extractor
      let extractedText = "";
      let extractionStatus: PromptAttachment["extraction_status"] = "ready";

      try {
        const result = await extractTextFromFile(file);
        if (result && result.text && result.text.trim().length > 0) {
          extractedText = result.text;
        } else {
          extractionStatus = "empty";
        }
      } catch (e) {
        console.error("Extraction failed for", file.name, e);
        extractionStatus = "failed";
      }

      // 2. Upload to Storage (ASCII-only key, original name stays in DB)
      const storagePath = `${promptId}/${buildSafeStorageFileName(file.name)}`;

      const { error: storageError } = await supabase.storage
        .from("prompt-attachments")
        .upload(storagePath, file);

      if (storageError) {
        console.error("Storage upload failed:", storageError);
        toast.error("Ошибка загрузки файла в хранилище");
        return null;
      }

      // 3. Insert DB record
      const maxSort = attachments.length > 0
        ? Math.max(...attachments.map(a => a.sort_order))
        : -1;

      const { data: inserted, error: dbError } = await supabase
        .from("ai_prompt_attachments")
        .insert({
          prompt_id: promptId,
          file_name: file.name,
          file_path: storagePath,
          file_type: fileType,
          file_size: file.size,
          extracted_text: extractedText || null,
          extracted_chars: extractedText.length,
          extraction_status: extractionStatus,
          sort_order: maxSort + 1,
        })
        .select()
        .single();

      if (dbError) {
        console.error("DB insert failed:", dbError);
        // Try to clean up storage
        await supabase.storage.from("prompt-attachments").remove([storagePath]);
        toast.error("Ошибка сохранения записи");
        return null;
      }

      setAttachments(prev => [...prev, inserted as PromptAttachment]);

      const statusLabels: Record<string, string> = {
        ready: "Текст извлечён",
        empty: "Текст не извлечён",
        failed: "Ошибка извлечения",
      };
      toast.success(`${file.name}: ${statusLabels[extractionStatus]}`);
      return inserted as PromptAttachment;
    } finally {
      setUploading(false);
    }
  }, [attachments]);

  const deleteAttachment = useCallback(async (id: string, filePath: string): Promise<DeleteResult> => {
    const result: DeleteResult = { storageDeleted: false, dbDeleted: false };

    // 1. Delete from Storage first
    const { error: storageError } = await supabase.storage
      .from("prompt-attachments")
      .remove([filePath]);

    if (storageError) {
      console.error("Storage delete failed:", storageError);
      toast.error("Не удалось удалить файл из хранилища");
    } else {
      result.storageDeleted = true;
    }

    // 2. Delete DB record
    const { error: dbError } = await supabase
      .from("ai_prompt_attachments")
      .delete()
      .eq("id", id);

    if (dbError) {
      console.error("DB delete failed:", dbError);
      toast.error("Не удалось удалить запись из базы данных");
    } else {
      result.dbDeleted = true;
      setAttachments(prev => prev.filter(a => a.id !== id));
    }

    if (result.storageDeleted && result.dbDeleted) {
      toast.success("Файл удалён");
    } else if (!result.storageDeleted && !result.dbDeleted) {
      toast.error("Не удалось удалить файл");
    }

    return result;
  }, []);

  return {
    attachments,
    loading,
    uploading,
    fetchAttachments,
    uploadAttachment,
    deleteAttachment,
  };
}
