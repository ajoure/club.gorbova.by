/**
 * PackageGenerationHistory — Sprint 3I-B.
 *
 * Сворачиваемая история запусков `ai-generate-document-package` для текущего
 * package_session_id. Источники:
 *   • `ai_document_generation_batches` (читаем напрямую, фильтр по session_id);
 *   • `ai_generated_documents` (по `generation_batch_id`).
 *
 * STOP:
 *   • никаких write-операций;
 *   • никаких обращений к Gotenberg / canonical-document-generate-strict;
 *   • не создаём новые RPC.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  History,
  FileText,
  FileDown,
  AlertCircle,
  FlaskConical,
} from "lucide-react";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { toast } from "sonner";

interface Props {
  packageSessionId: string | null;
  /** Если true — admin видит batches и других пользователей (по session_id фильтр). */
  isAdmin: boolean;
}

type BatchRow = {
  id: string;
  created_at: string;
  status: string;
  title: string;
  meta: Record<string, any> | null;
};

type DocRow = {
  id: string;
  template_name: string | null;
  title: string | null;
  status: string;
  document_number: string | null;
  document_date: string | null;
  generation_error: string | null;
  package_item_id: string | null;
  file_mime: string | null;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    generated: { label: "успешно", cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
    partial:   { label: "частично", cls: "bg-amber-50 text-amber-700 border-amber-300" },
    failed:    { label: "ошибка",   cls: "bg-rose-50 text-rose-700 border-rose-300" },
    blocked:   { label: "заблокировано", cls: "bg-rose-50 text-rose-700 border-rose-300" },
    pending:   { label: "в работе", cls: "bg-muted text-muted-foreground border-muted" },
    error:     { label: "ошибка",   cls: "bg-rose-50 text-rose-700 border-rose-300" },
    skipped:   { label: "пропущено", cls: "bg-muted text-muted-foreground border-muted" },
  };
  const v = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-muted" };
  return <Badge variant="outline" className={`text-[10px] ${v.cls}`}>{v.label}</Badge>;
}

function BatchDocuments({ batchId }: { batchId: string }) {
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["ai-document-generation-batch-documents", batchId],
    queryFn: async (): Promise<DocRow[]> => {
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select("id, template_name, title, status, document_number, document_date, generation_error, package_item_id, file_mime")
        .eq("generation_batch_id", batchId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="text-[11px] text-muted-foreground py-2">Загрузка документов…</div>;
  }
  if (docs.length === 0) {
    return <div className="text-[11px] text-muted-foreground py-2">Документы по этому запуску не найдены.</div>;
  }
  return (
    <div className="space-y-1.5">
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border bg-background">
          <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{d.title || d.template_name || "Документ"}</div>
            <div className="text-[10px] text-muted-foreground truncate">
              {d.document_number ? `№ ${d.document_number}` : "без номера"}
              {d.document_date ? ` · ${new Date(d.document_date).toLocaleDateString("ru-RU")}` : ""}
              {d.generation_error ? ` · ${d.generation_error}` : ""}
            </div>
          </div>
          {statusBadge(d.status)}
          <button
            type="button"
            onClick={async () => {
              const res = await downloadDocumentBlob(d.id, "pdf");
              if (!res.ok) toast.error((res as { message: string }).message);
            }}
            className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline"
          >
            <FileDown className="h-3 w-3" /> PDF
          </button>
          <button
            type="button"
            onClick={async () => {
              const res = await downloadDocumentBlob(d.id, "docx");
              if (!res.ok) toast.error((res as { message: string }).message);
            }}
            className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline"
          >
            <FileDown className="h-3 w-3" /> DOCX
          </button>
        </div>
      ))}
    </div>
  );
}

function BatchRowItem({ batch }: { batch: BatchRow }) {
  const [open, setOpen] = useState(false);
  const runMode = (batch.meta as any)?.run_mode as string | undefined;
  const generated = (batch.meta as any)?.generated ?? 0;
  const total = (batch.meta as any)?.total_items ?? "—";
  const errs = (batch.meta as any)?.errors ?? 0;
  const blocked = (batch.meta as any)?.blocked ?? 0;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <CollapsibleTrigger asChild>
        <button className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-accent/30">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium truncate">
              {new Date(batch.created_at).toLocaleString("ru-RU")}
              {runMode === "admin_test" && (
                <Badge variant="outline" className="ml-2 text-[9px] gap-1 bg-amber-50 text-amber-700 border-amber-300">
                  <FlaskConical className="h-2.5 w-2.5" /> тестовая
                </Badge>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {generated} из {total} сформировано
              {errs ? ` · ошибок: ${errs}` : ""}
              {blocked ? ` · блокировок: ${blocked}` : ""}
            </div>
          </div>
          {statusBadge(batch.status)}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1 border-t bg-muted/20">
        <BatchDocuments batchId={batch.id} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PackageGenerationHistory({ packageSessionId, isAdmin }: Props) {
  const [open, setOpen] = useState(false);

  const { data: batches = [], isLoading, isError } = useQuery({
    queryKey: ["ai-document-generation-batches", "by-session", packageSessionId],
    queryFn: async (): Promise<BatchRow[]> => {
      if (!packageSessionId) return [];
      const { data, error } = await supabase
        .from("ai_document_generation_batches")
        .select("id, created_at, status, title, meta")
        .filter("meta->>package_session_id", "eq", packageSessionId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as BatchRow[];
    },
    enabled: !!packageSessionId && open,
    staleTime: 15_000,
  });

  if (!packageSessionId) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
          {open ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
          <History className="h-3.5 w-3.5 mr-1" />
          История генераций{isAdmin ? " (все пользователи этой сессии)" : ""}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {isLoading && <div className="text-[11px] text-muted-foreground">Загрузка истории…</div>}
        {isError && (
          <div className="text-[11px] text-rose-700 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Не удалось загрузить историю
          </div>
        )}
        {!isLoading && !isError && batches.length === 0 && (
          <div className="text-[11px] text-muted-foreground">Ещё не было запусков.</div>
        )}
        {batches.map((b) => <BatchRowItem key={b.id} batch={b} />)}
      </CollapsibleContent>
    </Collapsible>
  );
}
