import { useState, useMemo } from "react";
import { useAiDocuments, type AiGeneratedDocument } from "@/hooks/useAiDocuments";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Download,
  Trash2,
  FileText,
  Loader2,
  Clock,
  Package,
  ChevronRight,
  ChevronDown,
  Eye,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { DocumentSnapshotDialog } from "./DocumentSnapshotDialog";
import { RegenerateDocumentDialog } from "./RegenerateDocumentDialog";

/* ── Types for grouped rendering ── */

type BatchGroup = {
  kind: "batch";
  batchId: string;
  batchTitle: string;
  maxCreatedAt: string;
  docs: AiGeneratedDocument[];
};

type StandaloneRow = {
  kind: "standalone";
  maxCreatedAt: string;
  doc: AiGeneratedDocument;
};

type HistoryEntry = BatchGroup | StandaloneRow;

/* ── Helpers ── */

function batchStatus(docs: AiGeneratedDocument[]): string {
  const statuses = docs.map((d) => d.status);
  const allGenerated = statuses.every((s) => s === "generated");
  const allError = statuses.every((s) => s === "error");
  const hasPending = statuses.some((s) => s === "pending" || s === "processing");

  if (allGenerated) return "generated";
  if (allError) return "error";
  if (hasPending) return "pending";
  return "partial";
}

function statusBadge(status: string) {
  switch (status) {
    case "generated":
      return <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 border-emerald-300/30">Готов</Badge>;
    case "error":
      return <Badge variant="destructive">Ошибка</Badge>;
    case "partial":
      return <Badge className="bg-amber-500/15 text-amber-600 border-amber-300/30">Частично</Badge>;
    case "pending":
    case "processing":
      return <Badge variant="secondary">В обработке</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function isCanonical(doc: AiGeneratedDocument): boolean {
  return Boolean(doc.template_version_id || doc.context_type || doc.idempotency_key);
}

function sourceLabel(doc: AiGeneratedDocument): string {
  if (doc.context_type === "order") return "Заказ";
  if (doc.context_type === "manual") return "Ручной";
  if (doc.generation_batch_id) return "Пакет";
  if (isCanonical(doc)) return "Новый генератор";
  return "Старый генератор";
}

/* ── Component ── */

export function AiDocumentsHistoryView() {
  const { documents, isLoading, deleteDocument, isDeleting, getDownloadUrl } = useAiDocuments();
  const [deletingDoc, setDeletingDoc] = useState<AiGeneratedDocument | null>(null);
  const [snapshotDoc, setSnapshotDoc] = useState<AiGeneratedDocument | null>(null);
  const [regenDoc, setRegenDoc] = useState<AiGeneratedDocument | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const [onlyCanonical, setOnlyCanonical] = useState(false);

  /* Build grouped + sorted list */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (onlyCanonical && !isCanonical(d)) return false;
      if (!q) return true;
      return (
        d.title?.toLowerCase().includes(q) ||
        d.template_name?.toLowerCase().includes(q) ||
        d.context_id?.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
      );
    });
  }, [documents, search, onlyCanonical]);

  const entries = useMemo<HistoryEntry[]>(() => {
    const batchMap = new Map<string, AiGeneratedDocument[]>();
    const standalone: AiGeneratedDocument[] = [];

    for (const doc of filtered) {
      if (doc.generation_batch_id) {
        const arr = batchMap.get(doc.generation_batch_id) || [];
        arr.push(doc);
        batchMap.set(doc.generation_batch_id, arr);
      } else {
        standalone.push(doc);
      }
    }

    const result: HistoryEntry[] = [];

    for (const [batchId, docs] of batchMap) {
      const maxCreatedAt = docs.reduce(
        (max, d) => (d.created_at > max ? d.created_at : max),
        docs[0].created_at,
      );
      const batchTitle = docs[0]?.batch?.title ?? "Пакет документов";
      docs.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      result.push({ kind: "batch", batchId, batchTitle, maxCreatedAt, docs });
    }

    for (const doc of standalone) {
      result.push({ kind: "standalone", maxCreatedAt: doc.created_at, doc });
    }

    result.sort((a, b) =>
      new Date(b.maxCreatedAt).getTime() - new Date(a.maxCreatedAt).getTime()
    );
    return result;
  }, [filtered]);

  /* Handlers */

  const toggleBatch = (batchId: string) => {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const handleDownload = async (doc: AiGeneratedDocument) => {
    if (!doc.file_path) return;
    const url = await getDownloadUrl(doc.file_path, doc.storage_bucket);
    if (url) {
      // download attribute via temp anchor
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name || `${doc.title || "document"}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const handlePreview = async (doc: AiGeneratedDocument) => {
    if (!doc.file_path) return;
    const url = await getDownloadUrl(doc.file_path, doc.storage_bucket);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const getDocxCheck = (doc: AiGeneratedDocument): {
    file_size?: number; unresolved_count?: number; ok?: boolean;
    unresolved_tokens?: string[];
  } | null => {
    const m: any = doc.meta || {};
    return m.docx_check ?? null;
  };

  const handleDelete = async () => {
    if (!deletingDoc) return;
    await deleteDocument(deletingDoc);
    setDeletingDoc(null);
  };

  /* Loading / empty */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <GlassCard className="text-center py-12">
        <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">История пуста</h3>
        <p className="text-sm text-muted-foreground">
          Сформированные документы появятся здесь.
        </p>
      </GlassCard>
    );
  }

  /* Render helpers */

  const renderDocActions = (doc: AiGeneratedDocument) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setSnapshotDoc(doc)}
        title="Слепок данных и источники"
      >
        <Eye className="h-4 w-4" />
      </Button>
      {isCanonical(doc) && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setRegenDoc(doc)}
          title="Перегенерировать"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}
      {doc.file_path && (doc.status === "generated" || doc.status === "success") && (
        <>
          <Button variant="ghost" size="icon" onClick={() => handlePreview(doc)} title="Открыть предпросмотр">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDownload(doc)} title="Скачать DOCX">
            <Download className="h-4 w-4" />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setDeletingDoc(doc)}
        title="Удалить"
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  const renderTechCells = (doc: AiGeneratedDocument) => (
    <>
      <TableCell className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
        {doc.template_version_id ? `v${doc.template_version ?? "?"}` : "—"}
      </TableCell>
      <TableCell className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]">
        {doc.context_id ?? "—"}
      </TableCell>
      <TableCell className="text-[11px] text-muted-foreground font-mono truncate max-w-[100px]">
        {doc.created_by ?? "—"}
      </TableCell>
    </>
  );

  const renderStandaloneRow = (doc: AiGeneratedDocument) => (
    <TableRow key={doc.id}>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {format(new Date(doc.created_at), "dd MMM yyyy, HH:mm", { locale: ru })}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate max-w-[200px]">{doc.title}</span>
          {isCanonical(doc) && (
            <Sparkles className="h-3 w-3 text-cyan-500 shrink-0" aria-label="Новый генератор" />
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
        {doc.template_name}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {sourceLabel(doc)}
      </TableCell>
      {showTechnical && renderTechCells(doc)}
      <TableCell>{statusBadge(doc.status)}</TableCell>
      <TableCell className="text-right">{renderDocActions(doc)}</TableCell>
    </TableRow>
  );

  const colSpan = showTechnical ? 7 : 4;

  const renderBatchGroup = (entry: BatchGroup) => {
    const isOpen = expandedBatches.has(entry.batchId);
    const aggStatus = batchStatus(entry.docs);
    const Chevron = isOpen ? ChevronDown : ChevronRight;

    return (
      <TableBody key={entry.batchId}>
        <TableRow
          className="cursor-pointer hover:bg-muted/50"
          onClick={() => toggleBatch(entry.batchId)}
        >
          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
            {format(new Date(entry.maxCreatedAt), "dd MMM yyyy, HH:mm", { locale: ru })}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Chevron className="h-4 w-4 text-muted-foreground shrink-0" />
              <Package className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate max-w-[200px]">
                {entry.batchTitle}
              </span>
              <Badge variant="outline" className="text-xs shrink-0">
                {entry.docs.length} док.
              </Badge>
            </div>
          </TableCell>
          <TableCell />
          <TableCell />
          {showTechnical && (
            <>
              <TableCell />
              <TableCell />
              <TableCell />
            </>
          )}
          <TableCell>{statusBadge(aggStatus)}</TableCell>
          <TableCell />
        </TableRow>

        {isOpen &&
          entry.docs.map((doc) => (
            <TableRow key={doc.id} className="bg-muted/20">
              <TableCell />
              <TableCell>
                <div className="flex items-center gap-2 pl-6">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate max-w-[200px]">{doc.title}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                {doc.template_name}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {sourceLabel(doc)}
              </TableCell>
              {showTechnical && renderTechCells(doc)}
              <TableCell>{statusBadge(doc.status)}</TableCell>
              <TableCell className="text-right">{renderDocActions(doc)}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию, шаблону, ID источника…"
          className="max-w-sm"
        />
        <div className="flex items-center gap-2">
          <Switch id="canonical-only" checked={onlyCanonical} onCheckedChange={setOnlyCanonical} />
          <Label htmlFor="canonical-only" className="text-xs cursor-pointer">
            Только новый генератор
          </Label>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Switch id="tech-history" checked={showTechnical} onCheckedChange={setShowTechnical} />
          <Label htmlFor="tech-history" className="text-xs cursor-pointer">
            Показать технические данные
          </Label>
        </div>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Документ</TableHead>
              <TableHead>Шаблон</TableHead>
              <TableHead>Источник</TableHead>
              {showTechnical && (
                <>
                  <TableHead>Версия</TableHead>
                  <TableHead>ID источника</TableHead>
                  <TableHead>Кто создал</TableHead>
                </>
              )}
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>

          {entries.length === 0 ? (
            <TableBody>
              <TableRow>
                <TableCell colSpan={colSpan + 2} className="text-center text-sm text-muted-foreground py-8">
                  Ничего не найдено по этим фильтрам.
                </TableCell>
              </TableRow>
            </TableBody>
          ) : (
            entries.map((entry) =>
              entry.kind === "batch" ? (
                renderBatchGroup(entry)
              ) : (
                <TableBody key={entry.doc.id}>
                  {renderStandaloneRow(entry.doc)}
                </TableBody>
              ),
            )
          )}
        </Table>
      </GlassCard>

      <DocumentSnapshotDialog
        open={!!snapshotDoc}
        onOpenChange={(v) => !v && setSnapshotDoc(null)}
        doc={snapshotDoc}
      />

      <RegenerateDocumentDialog
        open={!!regenDoc}
        onOpenChange={(v) => !v && setRegenDoc(null)}
        doc={regenDoc}
      />

      <AlertDialog open={!!deletingDoc} onOpenChange={() => setDeletingDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить документ?</AlertDialogTitle>
            <AlertDialogDescription>
              Документ «{deletingDoc?.title}» будет удалён вместе с файлом. Это действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
