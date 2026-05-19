/**
 * /document-download/:documentId
 *
 * UI-обёртка над edge function `document-download`. Сам файл всегда
 * приходит из backend как blob; пользователь и клиент НИКОГДА не видят
 * прямую ссылку на *.supabase.co. Адресная строка остаётся на нашем
 * домене.
 *
 * Ошибки переводятся в нейтральные пользовательские сообщения; никаких
 * технических деталей (bucket, file_path, backend host) не показывается.
 */
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Loader2, FileText, AlertCircle, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "loading" }
  | { kind: "ready"; blobUrl: string; fileName: string; mime: string }
  | { kind: "error"; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Нужно войти в аккаунт, чтобы скачать документ.",
  forbidden: "У вас нет доступа к этому документу.",
  document_not_found: "Документ не найден.",
  document_not_ready: "Документ ещё не готов.",
  docx_not_available: "Для этого документа нет DOCX-версии.",
  invalid_document_id: "Неверная ссылка на документ.",
  download_failed: "Не удалось скачать документ. Попробуйте позже.",
  internal_error: "Внутренняя ошибка. Попробуйте позже.",
};

function neutralMessage(code: string | null): string {
  if (!code) return "Не удалось скачать документ.";
  return ERROR_MESSAGES[code] || "Не удалось скачать документ.";
}

export default function DocumentDownloadPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const [search] = useSearchParams();
  const kind = search.get("kind") === "docx" ? "docx" : "pdf";
  const [state, setState] = useState<State>({ kind: "loading" });
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!documentId) {
        setState({ kind: "error", message: neutralMessage("invalid_document_id") });
        return;
      }
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session?.session?.access_token;
        if (!token) {
          setState({ kind: "error", message: neutralMessage("unauthorized") });
          return;
        }
        const projectId = (import.meta as any).env.VITE_SUPABASE_PROJECT_ID;
        const url = `https://${projectId}.functions.supabase.co/document-download?id=${encodeURIComponent(documentId)}&kind=${kind}`;
        const res = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          let code: string | null = null;
          try {
            const j = await res.json();
            code = j?.error || null;
          } catch { /* ignore */ }
          if (cancelled) return;
          setState({ kind: "error", message: neutralMessage(code) });
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        const cd = res.headers.get("Content-Disposition") || "";
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="([^"]+)"/i);
        const fileName = m ? decodeURIComponent(m[1]) : kind === "docx" ? "document.docx" : "document.pdf";
        const mime = res.headers.get("Content-Type") || (kind === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf");
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        setState({ kind: "ready", blobUrl, fileName, mime });

        // Автоматически инициируем скачивание через невидимый <a download>.
        // Это не открывает storage URL, файл остаётся в blob:.
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = fileName;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        console.error("[DocumentDownloadPage] failed", e);
        if (cancelled) return;
        setState({ kind: "error", message: neutralMessage("download_failed") });
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        setTimeout(() => URL.revokeObjectURL(blobUrlRef.current!), 60_000);
      }
    };
  }, [documentId, kind]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm text-center space-y-4">
        <div className="flex justify-center">
          <FileText className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">Документ</h1>
        {state.kind === "loading" && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Готовим файл к скачиванию…</span>
          </div>
        )}
        {state.kind === "ready" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Скачивание должно начаться автоматически.
            </p>
            <Button asChild>
              <a href={state.blobUrl} download={state.fileName}>
                <Download className="h-4 w-4 mr-2" /> Скачать снова
              </a>
            </Button>
          </div>
        )}
        {state.kind === "error" && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm font-medium">{state.message}</span>
            </div>
            <Button asChild variant="outline">
              <Link to="/purchases">К моим покупкам</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
