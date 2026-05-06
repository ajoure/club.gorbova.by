/**
 * RegenerateDocumentDialog — Sprint 6
 *
 * Открывает preview перегенерации (canonical-document-regenerate, mode=preview),
 * показывает diff старого слепка и нового, кнопка «Создать новую версию документа».
 *
 * Старая запись не модифицируется — создаётся новая ai_generated_documents
 * с regenerated_from_document_id и audit document.regenerated.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, Download, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AiGeneratedDocument } from "@/hooks/useAiDocuments";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: AiGeneratedDocument | null;
}

interface PreviewResp {
  success?: boolean;
  original?: { id: string; file_name?: string; snapshot?: any; created_at?: string };
  new_payload?: {
    resolved_tokens: Record<string, string>;
    missing_tokens: string[];
    unmapped_template_tokens?: string[];
    warnings?: string[];
    snapshot?: any;
  };
  diff?: Record<string, { from: any; to: any }>;
  diff_keys?: string[];
  error?: string;
}

export function RegenerateDocumentDialog({ open, onOpenChange, doc }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !doc) {
      setPreview(null);
      setError(null);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.functions.invoke("canonical-document-regenerate", {
          body: { document_id: doc.id, mode: "preview" },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        setPreview(data as PreviewResp);
      } catch (e: any) {
        setError(e?.message || "Не удалось получить предпросмотр");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, doc]);

  if (!doc) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-regenerate", {
        body: { document_id: doc.id, mode: "execute", confirm: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Создана новая версия документа");
      qc.invalidateQueries({ queryKey: ["ai-generated-documents"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка перегенерации");
    } finally {
      setBusy(false);
    }
  };

  const diffKeys = preview?.diff_keys ?? Object.keys(preview?.diff ?? {});
  const missing = preview?.new_payload?.missing_tokens ?? [];
  const blocked = missing.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Перегенерировать документ
          </DialogTitle>
          <DialogDescription>
            Сравнение текущего слепка и актуальных данных. Старая запись «{doc.title}» не изменится — будет создана новая.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="p-3 border border-destructive/30 bg-destructive/5 rounded-md text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {preview && !loading && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="outline">Изменено полей: {diffKeys.length}</Badge>
              {blocked && (
                <Badge variant="destructive">
                  Не хватает обязательных данных: {missing.length}
                </Badge>
              )}
              {(preview.new_payload?.unmapped_template_tokens?.length ?? 0) > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 border-amber-300/30">
                  Не сопоставлено в шаблоне: {preview.new_payload!.unmapped_template_tokens!.length}
                </Badge>
              )}
            </div>

            <ScrollArea className="flex-1 min-h-0 border rounded-md">
              {diffKeys.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Данные не изменились с момента последней генерации.
                </div>
              ) : (
                <div className="divide-y">
                  <div className="grid grid-cols-[1.2fr_1fr_1fr] px-3 py-2 bg-muted/40 text-xs font-medium">
                    <span>Поле</span>
                    <span>Было</span>
                    <span>Стало</span>
                  </div>
                  {diffKeys.map((k) => {
                    const d = preview.diff?.[k];
                    return (
                      <div key={k} className="grid grid-cols-[1.2fr_1fr_1fr] px-3 py-1.5 text-xs items-start">
                        <code className="text-[11px]">{k}</code>
                        <span className="font-mono text-[11px] break-all text-muted-foreground line-through">
                          {fmt(d?.from)}
                        </span>
                        <span className="font-mono text-[11px] break-all">{fmt(d?.to)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {missing.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Не хватает: {missing.slice(0, 8).join(", ")}{missing.length > 8 ? "…" : ""}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Закрыть
          </Button>
          <Button onClick={handleConfirm} disabled={busy || loading || !preview || blocked}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Создать новую версию документа
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmt(v: any): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
