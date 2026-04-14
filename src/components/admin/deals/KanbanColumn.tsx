import { useDroppable } from "@dnd-kit/core";
import { KanbanDealCard } from "./KanbanDealCard";
import { KanbanColumnHeader } from "./KanbanColumnHeader";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import type { CrmPipelineStage } from "@/services/pipelineService";
import { cn } from "@/lib/utils";

interface Props {
  stageId: string;
  name: string;
  color: string;
  stageType: "open" | "closed_won" | "closed_lost";
  deals: BoardDeal[];
  totals: { count: number; sum: number; avg: number };
  onOpenDeal: (id: string) => void;
  onMoveDeal?: (dealId: string, targetStageId: string) => void;
  availableStages: CrmPipelineStage[];
  canEdit: boolean;
  onRename?: (name: string) => void;
  onDelete?: (targetStageId: string) => void;
}

export function KanbanColumn({
  stageId,
  name,
  color,
  stageType,
  deals,
  totals,
  onOpenDeal,
  onMoveDeal,
  availableStages,
  canEdit,
  onRename,
  onDelete,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });

  const isClosed = stageType === "closed_won" || stageType === "closed_lost";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[280px] max-w-[320px] w-[280px] shrink-0 flex flex-col rounded-2xl border transition-all duration-200",
        "border-border/30 bg-card/15 backdrop-blur-md",
        isOver && "border-primary/50 bg-primary/5 shadow-lg",
        isClosed && stageType === "closed_won" && "bg-green-500/5 border-green-500/20",
        isClosed && stageType === "closed_lost" && "bg-red-500/5 border-red-500/20"
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
        availableStages={availableStages}
        hasDeals={deals.length > 0}
      />

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
              onOpen={() => onOpenDeal(deal.id)}
              onMoveTo={onMoveDeal ? (stageId) => onMoveDeal(deal.id, stageId) : undefined}
              availableStages={availableStages}
            />
          ))
        )}
      </div>
    </div>
  );
}
