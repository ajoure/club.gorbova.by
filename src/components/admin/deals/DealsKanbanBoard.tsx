import { useMemo, useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDealsBoard, type BoardDeal } from "@/hooks/useDealsBoard";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanDealCard } from "./KanbanDealCard";
import { KanbanSummaryStrip } from "./KanbanSummaryStrip";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";

interface Props {
  pipelineId: string;
  search?: string;
  productId?: string | null;
  onOpenDeal: (dealId: string) => void;
}

export function DealsKanbanBoard({ pipelineId, search, productId, onOpenDeal }: Props) {
  const { canWrite, isSuperAdmin } = usePermissions();
  const canEdit = canWrite("deals") || isSuperAdmin();

  const { stages, isLoading: stagesLoading, createStage, renameStage, deleteStage } =
    usePipelineStages(pipelineId);
  const { deals, isLoading: dealsLoading, moveDeal, groupByStage, getStageTotals } =
    useDealsBoard({ pipelineId, search, productId });

  const [activeDeal, setActiveDeal] = useState<BoardDeal | null>(null);
  const [showNewStage, setShowNewStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const grouped = useMemo(() => groupByStage(stages), [deals, stages]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const deal = deals.find((d) => d.id === e.active.id);
    setActiveDeal(deal || null);
  }, [deals]);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = e;
    if (!over || !canEdit) return;

    const dealId = active.id as string;
    const targetStageId = over.id as string;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.pipeline_stage_id === targetStageId) return;

    moveDeal({
      dealId,
      newStageId: targetStageId,
      oldStageId: deal.pipeline_stage_id,
    });
  }, [deals, canEdit, moveDeal]);

  const handleCreateStage = async () => {
    if (!newStageName.trim()) return;
    await createStage({ name: newStageName.trim() });
    setNewStageName("");
    setShowNewStage(false);
  };

  // Summary totals
  const summaryTotals = useMemo(() => {
    let totalActive = 0;
    let wonCount = 0;
    let wonSum = 0;
    let lostCount = 0;
    for (const s of stages) {
      const stageDeals = grouped[s.id] || [];
      const totals = getStageTotals(stageDeals);
      if (s.stage_type === "open") totalActive += totals.sum;
      if (s.stage_type === "closed_won") { wonCount = totals.count; wonSum = totals.sum; }
      if (s.stage_type === "closed_lost") lostCount = totals.count;
    }
    return { totalActive, wonCount, wonSum, lostCount, totalDeals: deals.length };
  }, [stages, grouped, deals, getStageTotals]);

  if (stagesLoading || dealsLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4 px-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="min-w-[280px] space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <KanbanSummaryStrip {...summaryTotals} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 px-1 min-h-[400px]">
          {/* Unassigned column */}
          {(grouped.__unassigned?.length || 0) > 0 && (
            <KanbanColumn
              stageId="__unassigned"
              name="Без стадии"
              color="#94a3b8"
              stageType="open"
              deals={grouped.__unassigned || []}
              totals={getStageTotals(grouped.__unassigned || [])}
              onOpenDeal={onOpenDeal}
              onMoveDeal={canEdit ? (dealId, stageId) => {
                const deal = deals.find(d => d.id === dealId);
                moveDeal({ dealId, newStageId: stageId, oldStageId: deal?.pipeline_stage_id || null });
              } : undefined}
              availableStages={stages}
              canEdit={canEdit}
            />
          )}

          {stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stageId={stage.id}
              name={stage.name}
              color={stage.color}
              stageType={stage.stage_type}
              deals={grouped[stage.id] || []}
              totals={getStageTotals(grouped[stage.id] || [])}
              onOpenDeal={onOpenDeal}
              onMoveDeal={canEdit ? (dealId, stageId) => {
                const deal = deals.find(d => d.id === dealId);
                moveDeal({ dealId, newStageId: stageId, oldStageId: deal?.pipeline_stage_id || null });
              } : undefined}
              availableStages={stages.filter((s) => s.id !== stage.id)}
              canEdit={canEdit}
              onRename={canEdit ? (name) => renameStage({ id: stage.id, name }) : undefined}
              onDelete={
                canEdit && stage.stage_type === "open"
                  ? (targetId) => deleteStage({ stageId: stage.id, targetStageId: targetId })
                  : undefined
              }
            />
          ))}

          {/* Add stage button */}
          {canEdit && (
            <div className="min-w-[260px] shrink-0">
              {showNewStage ? (
                <div className="p-3 rounded-xl border border-border/30 bg-card/20 backdrop-blur-md space-y-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder="Название стадии..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateStage();
                      if (e.key === "Escape") setShowNewStage(false);
                    }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateStage} disabled={!newStageName.trim()}>
                      Создать
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowNewStage(false)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="w-full h-12 border border-dashed border-border/40 rounded-xl text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewStage(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить стадию
                </Button>
              )}
            </div>
          )}
        </div>

        <DragOverlay>
          {activeDeal ? (
            <div className="opacity-80 rotate-2">
              <KanbanDealCard deal={activeDeal} onOpen={() => {}} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
