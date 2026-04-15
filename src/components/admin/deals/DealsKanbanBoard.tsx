import { useMemo, useState, useCallback, useRef, useEffect } from "react";
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
import { KanbanSummaryStrip } from "./KanbanSummaryStrip";
import { KanbanBulkActionsBar } from "./KanbanBulkActionsBar";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CrmPipelineStage } from "@/services/pipelineService";

interface Props {
  pipelineId: string;
  pipelineName?: string;
  isDefaultPipeline?: boolean;
  search?: string;
  productId?: string | null;
  tariffIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  onOpenDeal: (dealId: string) => void;
}

const formatCurrency = (v: number, currency?: string | null) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency: currency || "BYN",
    maximumFractionDigits: 0,
  }).format(v);

export function DealsKanbanBoard({ pipelineId, pipelineName, isDefaultPipeline, search, productId, tariffIds, dateFrom, dateTo, onOpenDeal }: Props) {
  const { canWrite, isSuperAdmin } = usePermissions();
  const canEdit = canWrite("deals") || isSuperAdmin();

  const { stages, isLoading: stagesLoading, createStage, renameStage, updateStageColor, deleteStage } =
    usePipelineStages(pipelineId);
  const { deals, isLoading: dealsLoading, moveDeal, groupByStage, getStageTotals } =
    useDealsBoard({ pipelineId, isDefaultPipeline, search, productId, tariffIds, dateFrom, dateTo });

  const [activeDeal, setActiveDeal] = useState<BoardDeal | null>(null);
  const [showNewStage, setShowNewStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");

  // Explicit selection mode toggle
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set());
  const bulkMode = selectionMode;

  // Exit selection mode on Escape
  useEffect(() => {
    if (!selectionMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectionMode(false);
        setSelectedDealIds(new Set());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectionMode]);

  // Clear selection when pipeline/filters change
  useEffect(() => {
    setSelectedDealIds(new Set());
    setSelectionMode(false);
  }, [pipelineId, search, productId, dateFrom, dateTo]);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        // Exiting: clear selection
        setSelectedDealIds(new Set());
      }
      return !prev;
    });
  }, []);

  const toggleSelect = useCallback((dealId: string) => {
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
      }
      return next;
    });
  }, []);

  const selectAllInStage = useCallback((stageId: string) => {
    const grouped = groupByStage(stages);
    const stageDeals = grouped[stageId] || [];
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      stageDeals.forEach((d) => next.add(d.id));
      return next;
    });
  }, [stages, groupByStage]);

  const deselectAllInStage = useCallback((stageId: string) => {
    const grouped = groupByStage(stages);
    const stageDeals = grouped[stageId] || [];
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      stageDeals.forEach((d) => next.delete(d.id));
      return next;
    });
  }, [stages, groupByStage]);

  const selectAll = useCallback(() => {
    setSelectedDealIds(new Set(deals.map((d) => d.id)));
  }, [deals]);

  const clearSelection = useCallback(() => {
    setSelectedDealIds(new Set());
    setSelectionMode(false);
  }, []);

  // Shared move menu state
  const [moveTarget, setMoveTarget] = useState<{ dealId: string; anchorEl: HTMLElement } | null>(null);
  const moveAnchorRef = useRef<HTMLDivElement>(null);

  // Disable drag sensors in bulk mode
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const emptySensors = useSensors();

  const grouped = useMemo(() => groupByStage(stages), [deals, stages]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    if (bulkMode) return;
    const deal = deals.find((d) => d.id === e.active.id);
    setActiveDeal(deal || null);
    setMoveTarget(null);
  }, [deals, bulkMode]);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveDeal(null);
    if (bulkMode) return;
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
  }, [deals, canEdit, moveDeal, bulkMode]);

  const handleCreateStage = async () => {
    if (!newStageName.trim()) return;
    await createStage({ name: newStageName.trim() });
    setNewStageName("");
    setShowNewStage(false);
  };

  const handleMoveClick = useCallback((dealId: string, anchorEl: HTMLElement) => {
    setMoveTarget({ dealId, anchorEl });
  }, []);

  const handleMoveToStage = useCallback((targetStageId: string) => {
    if (!moveTarget || !canEdit) return;
    const deal = deals.find(d => d.id === moveTarget.dealId);
    if (!deal) return;
    moveDeal({
      dealId: moveTarget.dealId,
      newStageId: targetStageId,
      oldStageId: deal.pipeline_stage_id,
    });
    setMoveTarget(null);
  }, [moveTarget, deals, canEdit, moveDeal]);

  const handleOpenDeal = useCallback((id: string) => {
    if (bulkMode) return;
    onOpenDeal(id);
  }, [onOpenDeal, bulkMode]);

  // Summary totals
  const summaryTotals = useMemo(() => {
    const unassigned = grouped.__unassigned || [];
    const unassignedTotals = getStageTotals(unassigned);

    let assignedCount = 0;
    let totalSum = unassignedTotals.sum;
    let wonCount = 0;
    let wonSum = 0;
    let lostCount = 0;

    for (const s of stages) {
      const stageDeals = grouped[s.id] || [];
      const totals = getStageTotals(stageDeals);
      totalSum += totals.sum;
      if (s.stage_type === "open") assignedCount += totals.count;
      if (s.stage_type === "closed_won") { wonCount = totals.count; wonSum = totals.sum; assignedCount += totals.count; }
      if (s.stage_type === "closed_lost") { lostCount = totals.count; assignedCount += totals.count; }
    }

    return {
      totalDeals: deals.length,
      totalSum,
      unassignedCount: unassignedTotals.count,
      assignedCount,
      wonCount,
      wonSum,
      lostCount,
    };
  }, [stages, grouped, deals, getStageTotals]);

  const moveMenuStages = useMemo(() => {
    if (!moveTarget) return [];
    const deal = deals.find(d => d.id === moveTarget.dealId);
    return stages.filter(s => s.id !== deal?.pipeline_stage_id);
  }, [moveTarget, deals, stages]);

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

  const anchorRect = moveTarget?.anchorEl?.getBoundingClientRect();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-3">
        <KanbanSummaryStrip {...summaryTotals} />

        {/* No top strip — selection mode managed via stage checkboxes + floating bar + Escape */}

        <DndContext
          sensors={bulkMode ? emptySensors : sensors}
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
                onOpenDeal={handleOpenDeal}
                onMoveClick={canEdit && !bulkMode ? handleMoveClick : undefined}
                showMoveButton={canEdit && stages.length > 0 && !bulkMode}
                availableStages={stages}
                canEdit={canEdit}
                pipelineId={pipelineId}
                bulkMode={bulkMode}
                selectedDealIds={selectedDealIds}
                onToggleSelect={toggleSelect}
                onSelectAllInStage={selectAllInStage}
                onDeselectAllInStage={deselectAllInStage}
                onEnterSelectionMode={() => setSelectionMode(true)}
                onExitSelectionMode={clearSelection}
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
                onOpenDeal={handleOpenDeal}
                onMoveClick={canEdit && !bulkMode ? handleMoveClick : undefined}
                showMoveButton={canEdit && stages.length > 1 && !bulkMode}
                availableStages={stages.filter((s) => s.id !== stage.id)}
                canEdit={canEdit}
                onRename={canEdit ? (name) => renameStage({ id: stage.id, name }) : undefined}
                onDelete={
                  canEdit && stage.stage_type === "open"
                    ? (targetId) => deleteStage({ stageId: stage.id, targetStageId: targetId })
                    : undefined
                }
                onChangeColor={
                  canEdit && stage.stage_type === "open"
                    ? (color) => updateStageColor({ id: stage.id, color })
                    : undefined
                }
                bulkMode={bulkMode}
                selectedDealIds={selectedDealIds}
                onToggleSelect={toggleSelect}
                onSelectAllInStage={selectAllInStage}
                onDeselectAllInStage={deselectAllInStage}
                onEnterSelectionMode={() => setSelectionMode(true)}
                onExitSelectionMode={clearSelection}
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

          {/* DragOverlay */}
          <DragOverlay>
            {activeDeal ? (
              <div className="p-3 rounded-xl border border-border/40 bg-card shadow-xl opacity-90 rotate-1 w-[260px] pointer-events-none">
                <div className="text-xs font-medium text-foreground truncate">{activeDeal.product_name || "—"}</div>
                {(activeDeal.contact_name || activeDeal.contact_email) && (
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {activeDeal.contact_name || activeDeal.contact_email}
                  </div>
                )}
                <div className="text-sm font-semibold text-foreground mt-1">
                  {formatCurrency(Number(activeDeal.final_price || 0), activeDeal.currency)}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Shared move menu */}
        {moveTarget && anchorRect && (
          <div
            ref={moveAnchorRef}
            style={{
              position: "fixed",
              top: anchorRect.bottom + 4,
              left: anchorRect.left,
              zIndex: 50,
            }}
          >
            <div
              className="bg-popover border rounded-md shadow-md py-1 w-48 animate-in fade-in-0 zoom-in-95"
              role="menu"
              onKeyDown={(e) => {
                if (e.key === "Escape") setMoveTarget(null);
              }}
            >
              {moveMenuStages.map((s) => (
                <button
                  key={s.id}
                  role="menuitem"
                  className="flex items-center w-full px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  onClick={() => handleMoveToStage(s.id)}
                >
                  <div
                    className="w-2 h-2 rounded-full mr-2 shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                </button>
              ))}
              {moveMenuStages.length === 0 && (
                <div className="px-3 py-1.5 text-sm text-muted-foreground">Нет доступных стадий</div>
              )}
            </div>
          </div>
        )}
        {moveTarget && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMoveTarget(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMoveTarget(null);
            }}
          />
        )}

        {/* Bulk actions floating bar */}
        {selectionMode && (
          <KanbanBulkActionsBar
            selectedIds={selectedDealIds}
            allDeals={deals}
            stages={stages}
            pipelineId={pipelineId}
            pipelineName={pipelineName}
            totalBoardDeals={deals.length}
            onClearSelection={clearSelection}
            onSelectAll={selectAll}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
