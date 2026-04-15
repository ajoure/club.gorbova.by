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
import { ArrowRight, Trash2, Download, X, Loader2, CheckSquare, FileSpreadsheet, FileText } from "lucide-react";
import { bulkAssignDealsToStage } from "@/services/pipelineService";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDealsBulkDelete } from "@/hooks/useDealsBulkDelete";
import { usePermissions } from "@/hooks/usePermissions";
import { exportToExcel, exportToCSV, type ExportColumn } from "@/utils/exportTableData";
import type { CrmPipelineStage } from "@/services/pipelineService";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import { cn } from "@/lib/utils";

interface Props {
  selectedIds: Set<string>;
  allDeals: BoardDeal[];
  stages: CrmPipelineStage[];
  pipelineId: string;
  pipelineName?: string;
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
  { header: "Дата создания", getValue: (d) => d.created_at },
];

export function KanbanBulkActionsBar({
  selectedIds,
  allDeals,
  stages,
  pipelineId,
  pipelineName,
  totalBoardDeals,
  onClearSelection,
  onSelectAll,
}: Props) {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const canDelete = isAdmin();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTargetStage, setMoveTargetStage] = useState<CrmPipelineStage | null>(null);
  const [isMoving, setIsMoving] = useState(false);

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
      const result = await bulkAssignDealsToStage(ids, pipelineId, moveTargetStage.id);
      toast.success(`Перемещено ${result.affected} сделок в «${moveTargetStage.name}»`);
      qc.invalidateQueries({ queryKey: ["deals-board"] });
      onClearSelection();
    } catch (err: any) {
      toast.error("Ошибка перемещения: " + (err?.message || String(err)));
    } finally {
      setIsMoving(false);
      setShowMoveDialog(false);
      setMoveTargetStage(null);
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <ArrowRight className="h-3.5 w-3.5" />
              Переместить
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56">
            {stages.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => {
                  setMoveTargetStage(s);
                  setShowMoveDialog(true);
                }}
              >
                <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: s.color }} />
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
                <p>
                  <strong>{count}</strong> сделок будут перемещены в стадию{" "}
                  <strong>«{moveTargetStage?.name}»</strong>
                  {pipelineName && <> в воронке <strong>«{pipelineName}»</strong></>}.
                </p>
                <p className="text-xs text-muted-foreground">
                  Затронуто стадий: {affectedStages.size}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMoving}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleMoveConfirm} disabled={isMoving}>
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
    </>
  );
}
