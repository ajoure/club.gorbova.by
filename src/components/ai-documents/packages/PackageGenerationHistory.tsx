/**
 * PackageGenerationHistory — Stage D.1 (UI grouping per-recipient).
 *
 * Сворачиваемая история запусков `ai-generate-document-package` для текущего
 * package_session_id. Источники:
 *   • `ai_document_generation_batches` (читаем напрямую, фильтр по session_id);
 *   • `ai_generated_documents` (по `generation_batch_id`).
 *
 * Stage D.1 frontend-only:
 *   • документы внутри одного batch группируются по
 *     (meta.package_item_id, meta.generation_mode);
 *   • per_role_person группа = сворачиваемая карточка
 *     «{template_name} — N получателей», сортировка по
 *     meta.recipient_index ASC NULLS LAST → created_at → id;
 *   • single = одна строка, как раньше;
 *   • разные batch никогда не смешиваются;
 *   • failed/blocked получатели показывают бейдж ошибки и disabled-скачивание
 *     при отсутствии файла.
 *
 * STOP:
 *   • никаких write-операций (никакого regenerate / cleanup / delete);
 *   • никаких новых параметров у edge function;
 *   • не зовём Gotenberg / canonical-document-generate-strict;
 *   • Stage E (selective regeneration) — НЕ здесь.
 */
import { useMemo, useState } from "react";
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
  Users,
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
  file_path: string | null;
  meta: Record<string, any> | null;
  created_at: string;
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

// ---------- Helpers ----------

function getMetaItemId(d: DocRow): string {
  return (d.meta?.package_item_id as string | undefined) ?? d.package_item_id ?? "__noitem__";
}
function getMetaMode(d: DocRow): string {
  return (d.meta?.generation_mode as string | undefined) ?? "single";
}
function getRecipientDisplayName(d: DocRow): string {
  const meta = d.meta ?? {};
  const recipient = (meta.recipient ?? {}) as Record<string, any>;
  const snap = (meta.recipient_snapshot ?? recipient.snapshot ?? {}) as Record<string, any>;
  const name =
    (meta.recipient_display_name as string | undefined) ??
    (recipient.display_name as string | undefined) ??
    (snap.full_name as string | undefined) ??
    null;
  if (name && name.trim()) return name;
  const pid =
    (meta.recipient_person_id as string | undefined) ??
    (recipient.person_id as string | undefined);
  if (pid) return `Получатель ${pid.slice(0, 8)}`;
  const idx = meta.recipient_index ?? recipient.index;
  if (idx != null) return `Получатель #${idx}`;
  return "Получатель";
}
function getRecipientIndex(d: DocRow): number | null {
  const meta = d.meta ?? {};
  const recipient = (meta.recipient ?? {}) as Record<string, any>;
  const raw = meta.recipient_index ?? recipient.index ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function isDownloadable(d: DocRow): boolean {
  return d.status === "generated" || !!d.file_path;
}

// ---------- Single recipient row ----------
function DocRecipientRow({ d, label }: { d: DocRow; label?: string }) {
  const canDownload = isDownloadable(d);
  return (
    <div className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border bg-background">
      <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{label ?? d.title ?? d.template_name ?? "Документ"}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {d.document_number ? `№ ${d.document_number}` : "без номера"}
          {d.document_date ? ` · ${new Date(d.document_date).toLocaleDateString("ru-RU")}` : ""}
          {d.generation_error ? ` · ${d.generation_error}` : ""}
        </div>
      </div>
      {statusBadge(d.status)}
      <button
        type="button"
        disabled={!canDownload}
        title={canDownload ? undefined : "Файл не создан"}
        onClick={async () => {
          if (!canDownload) return;
          const res = await downloadDocumentBlob(d.id, "pdf");
          if (!res.ok) toast.error((res as { message: string }).message);
        }}
        className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline disabled:text-muted-foreground disabled:hover:no-underline disabled:cursor-not-allowed"
      >
        <FileDown className="h-3 w-3" /> PDF
      </button>
      <button
        type="button"
        disabled={!canDownload}
        title={canDownload ? undefined : "Файл не создан"}
        onClick={async () => {
          if (!canDownload) return;
          const res = await downloadDocumentBlob(d.id, "docx");
          if (!res.ok) toast.error((res as { message: string }).message);
        }}
        className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline disabled:text-muted-foreground disabled:hover:no-underline disabled:cursor-not-allowed"
      >
        <FileDown className="h-3 w-3" /> DOCX
      </button>
    </div>
  );
}

// ---------- Per-role group ----------
function PerRoleGroup({ docs }: { docs: DocRow[] }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => {
    const arr = [...docs];
    arr.sort((a, b) => {
      const ai = getRecipientIndex(a);
      const bi = getRecipientIndex(b);
      if (ai == null && bi != null) return 1;
      if (bi == null && ai != null) return -1;
      if (ai != null && bi != null && ai !== bi) return ai - bi;
      const ac = a.created_at ?? "";
      const bc = b.created_at ?? "";
      if (ac !== bc) return ac < bc ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return arr;
  }, [docs]);
  const total = sorted.length;
  const okCount = sorted.filter((d) => d.status === "generated").length;
  const errCount = total - okCount;
  const templateName = sorted[0]?.template_name ?? sorted[0]?.title ?? "Документ";

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <CollapsibleTrigger asChild>
        <button className="w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-accent/30">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Users className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium truncate">
              {templateName} — {total} {total === 1 ? "получатель" : "получателей"}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {okCount} из {total} успешно
              {errCount > 0 ? ` · ${errCount} с ошибкой` : ""}
            </div>
          </div>
          {errCount > 0 ? (
            <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-300">
              {errCount} ошибка
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
              {okCount}/{total}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2 pt-1 border-t bg-muted/10 space-y-1.5">
        {sorted.map((d) => (
          <DocRecipientRow key={d.id} d={d} label={getRecipientDisplayName(d)} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------- Batch documents block ----------
function BatchDocuments({ batchId }: { batchId: string }) {
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["ai-document-generation-batch-documents", batchId],
    queryFn: async (): Promise<DocRow[]> => {
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select(
          "id, template_name, title, status, document_number, document_date, generation_error, package_item_id, file_mime, file_path, meta, created_at",
        )
        .eq("generation_batch_id", batchId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
    staleTime: 30_000,
  });

  // Группируем по (package_item_id, generation_mode).
  // Single-доки (mode != per_role_person) НИКОГДА не сворачиваются.
  const groups = useMemo(() => {
    const map = new Map<string, DocRow[]>();
    for (const d of docs) {
      const key = `${getMetaItemId(d)}::${getMetaMode(d)}`;
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, items]) => {
      const [itemId, mode] = key.split("::");
      return { itemId, mode, items };
    });
  }, [docs]);

  if (isLoading) {
    return <div className="text-[11px] text-muted-foreground py-2">Загрузка документов…</div>;
  }
  if (docs.length === 0) {
    return <div className="text-[11px] text-muted-foreground py-2">Документы по этому запуску не найдены.</div>;
  }
  return (
    <div className="space-y-1.5">
      {groups.map((g) => {
        if (g.mode === "per_role_person" && g.items.length > 0) {
          return <PerRoleGroup key={`${g.itemId}-${g.mode}`} docs={g.items} />;
        }
        // single (или mode не задан) — каждая строка отдельно
        return g.items.map((d) => <DocRecipientRow key={d.id} d={d} />);
      })}
    </div>
  );
}

function BatchRowItem({ batch, defaultOpen = false }: { batch: BatchRow; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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
              Batch {batch.id.slice(0, 8)} · {new Date(batch.created_at).toLocaleString("ru-RU")}
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
        {batches.map((b, idx) => (
          <BatchRowItem key={b.id} batch={b} defaultOpen={idx === 0} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
