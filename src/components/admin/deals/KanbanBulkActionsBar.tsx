import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowRight, Trash2, Download, X, Loader2, CheckSquare, FileSpreadsheet, FileText, Handshake } from "lucide-react";
import { bulkMoveDealsToPipeline } from "@/services/pipelineService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealsBulkDelete } from "@/hooks/useDealsBulkDelete";
import { usePermissions } from "@/hooks/usePermissions";
import { exportToExcel, exportToCSV, type ExportColumn } from "@/utils/exportTableData";
import type { CrmPipelineStage } from "@/services/pipelineService";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import { cn } from "@/lib/utils";
import { usePipelines } from "@/hooks/usePipelines";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BulkCreateDealsDialog } from "./BulkCreateDealsDialog";

interface Props {
  selectedIds: Set<string>;
  allDeals: BoardDeal[];
  pipelineId: string;
  totalBoardDeals: number;
  onClearSelection: () => void;
  onSelectAll: () => void;
}

const EXPORT_COLUMNS: ExportColumn<BoardDeal>[] = [
  { header: "Номер", getValue: (d) => d.order_number },
  { header: "Статус", getValue: (d) => d.status },
  { header: "Продукт", getValue: (d) => d.product_name || "" },
  { header: "Тариф", getValue: (d) => d.tariff_name || "" },
  { header: "Сумма", getValue: (d) => Number(d.final_price || 0) },
  { header: "Валюта", getValue: (d) => d.currency || "BYN" },
  { header: "Контакт", getValue: (d) => d.contact_name || d.contact_email || "" },
  { header: "Менеджер продажи", getValue: (d) => d.responsible_name || "Без менеджера" },
  { header: "Дата создания", getValue: (d) => d.created_at },
];

export function KanbanBulkActionsBar({
  selectedIds,
  allDeals,
  pipelineId,
  totalBoardDeals,
  onClearSelection,
  onSelectAll,
}: Props) {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const canDelete = isAdmin();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [targetPipelineId, setTargetPipelineId] = useState(pipelineId);
  const [targetStageId, setTargetStageId] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [showCreateFromDeals, setShowCreateFromDeals] = useState(false);
  const { pipelines } = usePipelines();
  const { data: targetStages = [], isLoading: targetStagesLoading } = useQuery({
    queryKey: ["crm-pipeline-stages", targetPipelineId, "bulk-move"],
    enabled: showMoveDialog && !!targetPipelineId,
    queryFn: async (): Promise<CrmPipelineStage[]> => {
      const { data, error } = await supabase.from("crm_pipeline_stages").select("*")
        .eq("pipeline_id", targetPipelineId).order("order_index");
      if (error) throw error;
      return (data ?? []) as unknown as CrmPipelineStage[];
    },
  });
  const moveTargetStage = targetStages.find((stage) => stage.id === targetStageId) ?? null;
  const targetPipeline = pipelines.find((item) => item.id === targetPipelineId) ?? null;
  const pipelineName = pipelines.find((item) => item.id === pipelineId)?.name ?? "";

  useEffect(() => {
    if (!showMoveDialog || targetStages.length === 0) return;
    if (!targetStages.some((stage) => stage.id === targetStageId)) {
      setTargetStageId((targetStages.find((stage) => stage.is_default) ?? targetStages[0]).id);
    }
  }, [showMoveDialog, targetStageId, targetStages]);

  const deleteMutation = useDealsBulkDelete({
    onSuccess: () => {
      onClearSelection();
    },
  });

  const selectedDeals = allDeals.filter((d) => selectedIds.has(d.id));
  const count = selectedIds.size;

  // Escape to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClearSelection();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClearSelection]);

  if (count === 0) return null;

  // Count stages affected
  const affectedStages = new Set(selectedDeals.map((d) => d.pipeline_stage_id || "__unassigned"));

  const handleMoveConfirm = async () => {
    if (!moveTargetStage) return;
    setIsMoving(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await bulkMoveDealsToPipeline(ids, targetPipelineId, moveTargetStage.id);
      toast.success(`Перемещено ${result.affected} сделок в «${targetPipeline?.name ?? "Воронка"} / ${moveTargetStage.name}»`);
      qc.invalidateQueries({ queryKey: ["deals-board"] });
      qc.invalidateQueries({ queryKey: ["admin-deals"] });
      qc.invalidateQueries({ queryKey: ["pipeline-deal-counts"] });
      onClearSelection();
    } catch (err: any) {
      toast.error("Ошибка перемещения: " + (err?.message || String(err)));
    } finally {
      setIsMoving(false);
      setShowMoveDialog(false);
      setTargetStageId("");
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate(Array.from(selectedIds));
    setShowDeleteDialog(false);
  };

  const handleExport = (format: "xlsx" | "csv") => {
    if (format === "xlsx") {
      exportToExcel(selectedDeals, EXPORT_COLUMNS, `deals_export_${count}.xlsx`);
    } else {
      exportToCSV(selectedDeals, EXPORT_COLUMNS, `deals_export_${count}.csv`);
    }
    toast.success(`Экспортировано ${count} сделок`);
  };

  return (
    <>
      <div
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
          "flex items-center gap-2 px-4 py-2.5 rounded-2xl",
          "bg-card/80 backdrop-blur-2xl border border-border/40",
          "shadow-[0_8px_40px_rgba(0,0,0,0.15)]",
          "animate-in slide-in-from-bottom-4 fade-in-0 duration-200"
        )}
      >
        {/* Counter */}
        <div className="flex items-center gap-2 mr-1">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground whitespace-nowrap">
            Выбрано: {count}
          </span>
          {count < totalBoardDeals && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onSelectAll}
            >
              Все ({totalBoardDeals})
            </Button>
          )}
        </div>

        <div className="h-5 w-px bg-border/40" />

        {/* Move */}
        {canDelete && <>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => {
            setTargetPipelineId(pipelineId);
            setTargetStageId("");
            setShowMoveDialog(true);
          }}>
            <ArrowRight className="h-3.5 w-3.5" />
            Переместить
          </Button>

          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-emerald-700 hover:text-emerald-800" onClick={() => setShowCreateFromDeals(true)}>
            <Handshake className="h-3.5 w-3.5" />
            Создать на основании
          </Button>
        </>}

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              Экспорт
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuItem onClick={() => handleExport("xlsx")}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
              Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("csv")}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Delete — admin only */}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowDeleteDialog(true)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Удалить
          </Button>
        )}

        <div className="h-5 w-px bg-border/40" />

        {/* Close */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={onClearSelection}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Move confirm dialog */}
      <AlertDialog open={showMoveDialog} onOpenChange={(open) => !open && setShowMoveDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Переместить {count} сделок?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5">
                <p>Выберите целевую воронку и стадию. Сделки, задачи, платежи и лента сохранятся.</p>
                <p className="text-xs text-muted-foreground">
                  Затронуто стадий: {affectedStages.size}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Воронка</Label>
              <Select value={targetPipelineId} onValueChange={(value) => { setTargetPipelineId(value); setTargetStageId(""); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Выберите воронку" /></SelectTrigger>
                <SelectContent>{pipelines.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Стадия</Label>
              <Select value={targetStageId} onValueChange={setTargetStageId} disabled={targetStagesLoading || targetStages.length === 0}>
                <SelectTrigger className="h-9"><SelectValue placeholder={targetStagesLoading ? "Загрузка…" : "Выберите стадию"} /></SelectTrigger>
                <SelectContent>{targetStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMoving}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleMoveConfirm} disabled={isMoving || !moveTargetStage}>
              {isMoving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Переместить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {count} сделок?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Будет безвозвратно удалено <strong>{count}</strong> сделок
                  {pipelineName && <> из воронки <strong>«{pipelineName}»</strong></>}.
                </p>
                <p className="text-xs text-muted-foreground">
                  Затронуто стадий: {affectedStages.size}
                </p>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                  <Trash2 className="h-4 w-4 shrink-0" />
                  <span>Это реальное удаление, не архив. Действие нельзя отменить.</span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BulkCreateDealsDialog
        open={showCreateFromDeals}
        onOpenChange={setShowCreateFromDeals}
        sourceType="deal"
        sourceIds={Array.from(selectedIds)}
        defaultPipelineId={pipelineId}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["deals-board"] });
          qc.invalidateQueries({ queryKey: ["admin-deals"] });
          onClearSelection();
        }}
      />
    </>
  );
}
