/**
 * downloadDocumentBlob — canonical client-side downloader for generated documents.
 *
 * Использует наш единый edge function `document-download`. Файл приходит как
 * blob, скачивается через blob: URL. Никаких прямых signed URL на
 * *.supabase.co. Возвращает true при успехе.
 */
import { supabase } from "@/integrations/supabase/client";

export type DocumentKind = "pdf" | "docx";

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Нужно войти в аккаунт.",
  forbidden: "Нет доступа к документу.",
  document_not_found: "Документ не найден.",
  document_not_ready: "Документ ещё не готов.",
  docx_not_available: "DOCX-версия недоступна.",
  invalid_document_id: "Неверный документ.",
  download_failed: "Не удалось скачать документ.",
  internal_error: "Внутренняя ошибка.",
};

export async function downloadDocumentBlob(
  documentId: string,
  kind: DocumentKind = "pdf",
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return { ok: false, message: ERROR_MESSAGES.unauthorized };

    const projectId = (import.meta as any).env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.functions.supabase.co/document-download?id=${encodeURIComponent(documentId)}&kind=${kind}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let code: string | null = null;
      try { code = (await res.json())?.error || null; } catch { /* ignore */ }
      return { ok: false, message: ERROR_MESSAGES[code || ""] || ERROR_MESSAGES.download_failed };
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="([^"]+)"/i);
    const fileName = m
      ? decodeURIComponent(m[1])
      : kind === "docx" ? "document.docx" : "document.pdf";
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return { ok: true };
  } catch (e) {
    console.error("[downloadDocumentBlob] failed", e);
    return { ok: false, message: ERROR_MESSAGES.download_failed };
  }
}
