import { useState, memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { KanbanDealCard } from "./KanbanDealCard";
import { KanbanColumnHeader } from "./KanbanColumnHeader";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import type { CrmPipelineStage } from "@/services/pipelineService";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ArrowRight, Loader2 } from "lucide-react";
import { bulkAssignDealsToStage } from "@/services/pipelineService";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getStageBackgroundStyle } from "@/lib/stagePalette";

interface Props {
  stageId: string;
  name: string;
  color: string;
  stageType: "open" | "closed_won" | "closed_lost";
  deals: BoardDeal[];
  totals: { count: number; sum: number; avg: number };
  onOpenDeal: (id: string) => void;
  onMoveClick?: (dealId: string, anchorEl: HTMLElement) => void;
  showMoveButton: boolean;
  availableStages: CrmPipelineStage[];
  canEdit: boolean;
  onRename?: (name: string) => void;
  onDelete?: (targetStageId: string) => void;
  onChangeColor?: (color: string) => void;
  pipelineId?: string;
  // Bulk selection props
  bulkMode?: boolean;
  selectedDealIds?: Set<string>;
  onToggleSelect?: (dealId: string) => void;
  onSelectAllInStage?: (stageId: string) => void;
  onDeselectAllInStage?: (stageId: string) => void;
  onEnterSelectionMode?: () => void;
  onExitSelectionMode?: () => void;
  // Stage drag handle props
  dragHandleProps?: {
    attributes: Record<string, any>;
    listeners: Record<string, any> | undefined;
  };
}

export const KanbanColumn = memo(function KanbanColumn({
  stageId,
  name,
  color,
  stageType,
  deals,
  totals,
  onOpenDeal,
  onMoveClick,
  showMoveButton,
  availableStages,
  canEdit,
  onRename,
  onDelete,
  onChangeColor,
  pipelineId,
  bulkMode,
  selectedDealIds,
  onToggleSelect,
  onSelectAllInStage,
  onDeselectAllInStage,
  onEnterSelectionMode,
  onExitSelectionMode,
  dragHandleProps,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const qc = useQueryClient();

  const [bulkTarget, setBulkTarget] = useState<CrmPipelineStage | null>(null);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);

  const isUnassigned = stageId === "__unassigned";

  const selectedCount = deals.filter((d) => selectedDealIds?.has(d.id)).length;

  // Dynamic tinted background for ALL stages
  const bgStyle = getStageBackgroundStyle(color, stageType);

  const handleBulkAssign = async () => {
    if (!bulkTarget || !pipelineId) return;
    setIsBulkAssigning(true);
    try {
      const dealIds = deals.map(d => d.id);
      const result = await bulkAssignDealsToStage(dealIds, pipelineId, bulkTarget.id);
      toast.success(`Назначено ${result.affected} сделок в стадию «${bulkTarget.name}»`);
      qc.invalidateQueries({ queryKey: ["deals-board"] });
    } catch (err: any) {
      toast.error("Ошибка массового назначения: " + (err?.message || String(err)));
    } finally {
      setIsBulkAssigning(false);
      setBulkTarget(null);
    }
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={{
          backgroundColor: bgStyle.backgroundColor,
          borderColor: isOver && !bulkMode ? undefined : bgStyle.borderColor,
        }}
        className={cn(
          "min-w-[280px] max-w-[320px] w-[280px] shrink-0 flex flex-col rounded-2xl border transition-colors duration-200",
          isOver && !bulkMode && "border-primary/50 shadow-lg",
        )}
      >
        <KanbanColumnHeader
          name={name}
          color={color}
          stageType={stageType}
          count={totals.count}
          sum={totals.sum}
          avg={totals.avg}
          canEdit={canEdit}
          onRename={onRename}
          onDelete={onDelete}
          onChangeColor={stageType === "open" ? onChangeColor : undefined}
          availableStages={availableStages}
          hasDeals={deals.length > 0}
          selectedCount={selectedCount}
          totalInStage={deals.length}
          bulkMode={bulkMode}
          onSelectAll={() => onSelectAllInStage?.(stageId)}
          onDeselectAll={() => onDeselectAllInStage?.(stageId)}
          onEnterSelectionMode={onEnterSelectionMode}
          onExitSelectionMode={onExitSelectionMode}
        />

        {/* Bulk assign button for unassigned column */}
        {isUnassigned && canEdit && deals.length > 0 && availableStages.length > 0 && (
          <div className="px-2 pt-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5">
                  <ArrowRight className="h-3 w-3" />
                  Назначить все ({deals.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {availableStages.filter(s => s.stage_type === "open").map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setBulkTarget(s)}
                  >
                    <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-320px)] scrollbar-none">
          {deals.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground/60">
              Нет сделок
            </div>
          ) : (
            deals.map((deal) => (
              <KanbanDealCard
                key={deal.id}
                deal={deal}
                onOpenDeal={onOpenDeal}
                onMoveClick={onMoveClick}
                showMoveButton={showMoveButton}
                bulkMode={bulkMode}
                isSelected={selectedDealIds?.has(deal.id)}
                onToggleSelect={onToggleSelect}
                stageColor={color}
                stageType={stageType}
              />
            ))
          )}
        </div>
      </div>

      {/* Bulk assign confirm dialog */}
      <AlertDialog open={!!bulkTarget} onOpenChange={(open) => !open && setBulkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Назначить {deals.length} сделок?</AlertDialogTitle>
            <AlertDialogDescription>
              Все сделки из колонки «{name}» будут перемещены в стадию «{bulkTarget?.name}».
              Это действие затронет <strong>{deals.length}</strong> сделок.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkAssigning}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkAssign} disabled={isBulkAssigning}>
              {isBulkAssigning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Назначить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
