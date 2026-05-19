/**
 * Canonical URL builder for document downloads.
 *
 * SOURCE OF TRUTH: ссылка на скачивание любого сгенерированного документа
 * ОБЯЗАНА указывать только на наш домен. Никаких `*.supabase.co`,
 * никаких прямых signed-URL'ов на storage backend.
 *
 *   https://gorbova.by/document-download/<document_id>?kind=pdf|docx
 *
 * Используется и в frontend (UI-кнопки, email-ссылки в шаблонах),
 * и в edge functions через `getDocumentDownloadUrl()`.
 */

export const CANONICAL_APP_HOST = "https://gorbova.by";

/** Resolve the canonical app base URL. Forbids preview / supabase hosts. */
export function getPublicAppBaseUrl(): string {
  // Vite-injected (build-time). Если хост попадает в запрещённый список —
  // игнорируем и возвращаем canonical production host.
  const envHost =
    (import.meta as any)?.env?.VITE_PUBLIC_SITE_URL ||
    (import.meta as any)?.env?.PUBLIC_SITE_URL ||
    "";
  if (envHost && /^https:\/\//i.test(envHost) && !/supabase\.(co|in)|lovable\.(app|dev)|lovableproject\.com|localhost|127\.0\.0\.1/i.test(envHost)) {
    return envHost.replace(/\/+$/, "");
  }
  return CANONICAL_APP_HOST;
}

/** Build canonical document download URL. */
export function getDocumentDownloadUrl(
  documentId: string,
  kind: "pdf" | "docx" = "pdf",
): string {
  const base = getPublicAppBaseUrl();
  const q = kind === "docx" ? "?kind=docx" : "";
  return `${base}/document-download/${documentId}${q}`;
}
