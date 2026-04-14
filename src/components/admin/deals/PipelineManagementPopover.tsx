import React, { useState, useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Pencil, Trash2, Plus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CrmPipeline } from "@/services/pipelineService";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface PipelineManagementPopoverProps {
  pipelines: CrmPipeline[];
  activePipelineId: string;
  onSelect: (id: string) => void;
  onRename: (pipeline: { id: string; name: string }) => void;
  onDelete: (pipeline: { id: string; name: string }) => void;
  onCreate: () => void;
  onReorder: (orderedIds: string[]) => Promise<void>;
  canEdit: boolean;
  /** Map of pipeline_id → deal count (for delete guard) */
  dealCounts?: Map<string, number>;
  /** Set of pipeline_ids that have product bindings */
  boundPipelineIds?: Set<string>;
}

// ─── Sortable Item ───
function SortablePipelineItem({
  pipeline,
  isActive,
  canEdit,
  canDelete,
  deleteReason,
  onSelect,
  onRename,
  onDelete,
}: {
  pipeline: CrmPipeline;
  isActive: boolean;
  canEdit: boolean;
  canDelete: boolean;
  deleteReason?: string;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pipeline.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/item flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all duration-150 cursor-pointer select-none",
        isActive
          ? "bg-primary/10 border-l-2 border-primary"
          : "hover:bg-muted/50 border-l-2 border-transparent",
        isDragging && "shadow-lg bg-card/90 backdrop-blur-xl z-50 opacity-90"
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      {canEdit && (
        <button
          className="flex-shrink-0 touch-none cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted/60 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Name + badge */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className={cn(
          "text-sm truncate",
          isActive ? "font-semibold text-foreground" : "font-medium text-foreground/80"
        )}>
          {pipeline.name}
        </span>
        {pipeline.is_default && (
          <Badge
            variant="secondary"
            className="flex-shrink-0 text-[9px] h-4 px-1.5 bg-primary/15 text-primary border-0"
          >
            основная
          </Badge>
        )}
      </div>

      {/* Actions */}
      {canEdit && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity flex-shrink-0">
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Переименовать"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
          {!pipeline.is_default && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "h-5 w-5 flex items-center justify-center rounded transition-colors",
                      canDelete
                        ? "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        : "text-muted-foreground/30 cursor-not-allowed"
                    )}
                    title={canDelete ? "Удалить" : deleteReason}
                    disabled={!canDelete}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canDelete) onDelete();
                    }}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </TooltipTrigger>
                {!canDelete && deleteReason && (
                  <TooltipContent side="right" className="text-xs max-w-48">
                    {deleteReason}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Popover ───
export function PipelineManagementPopover({
  pipelines,
  activePipelineId,
  onSelect,
  onRename,
  onDelete,
  onCreate,
  onReorder,
  canEdit,
  dealCounts,
  boundPipelineIds,
}: PipelineManagementPopoverProps) {
  const [open, setOpen] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const orderedPipelines = useMemo(() => {
    if (!localOrder) return pipelines;
    return localOrder
      .map((id) => pipelines.find((p) => p.id === id))
      .filter(Boolean) as CrmPipeline[];
  }, [pipelines, localOrder]);

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentIds = orderedPipelines.map((p) => p.id);
    const oldIndex = currentIds.indexOf(active.id as string);
    const newIndex = currentIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(currentIds, oldIndex, newIndex);

    // Skip if order unchanged
    const unchanged = newOrder.every((id, i) => id === currentIds[i]);
    if (unchanged) return;

    setLocalOrder(newOrder);
    onReorder(newOrder).catch(() => setLocalOrder(null));
  }

  function getDeleteGuard(p: CrmPipeline): { canDelete: boolean; reason?: string } {
    if (p.is_default) return { canDelete: false, reason: "Основную воронку нельзя удалить" };
    const count = dealCounts?.get(p.id) ?? 0;
    if (count > 0) return { canDelete: false, reason: `В воронке ${count} сделок` };
    if (boundPipelineIds?.has(p.id)) return { canDelete: false, reason: "Привязана к продукту" };
    return { canDelete: true };
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setLocalOrder(null); }}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-3 rounded-xl text-xs font-medium",
            "bg-card/50 backdrop-blur-md border border-border/30",
            "hover:bg-card/70 hover:border-border/50",
            "transition-all duration-200 cursor-pointer select-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
          <span className="truncate max-w-[180px]">
            {activePipeline?.name || "Воронка"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-40 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "w-72 p-2 rounded-2xl",
          "bg-card/80 backdrop-blur-2xl border-border/20",
          "shadow-2xl shadow-black/10"
        )}
      >
        <div className="space-y-1">
          {/* Header */}
          <div className="px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Воронки продаж
            </span>
          </div>

          {/* Sortable list */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedPipelines.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0.5">
                {orderedPipelines.map((p) => {
                  const guard = getDeleteGuard(p);
                  return (
                    <SortablePipelineItem
                      key={p.id}
                      pipeline={p}
                      isActive={p.id === activePipelineId}
                      canEdit={canEdit}
                      canDelete={guard.canDelete}
                      deleteReason={guard.reason}
                      onSelect={() => { onSelect(p.id); setOpen(false); }}
                      onRename={() => onRename({ id: p.id, name: p.name })}
                      onDelete={() => onDelete({ id: p.id, name: p.name })}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          {/* Create */}
          {canEdit && (
            <>
              <div className="h-px bg-border/20 mx-1 my-1" />
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                onClick={() => { onCreate(); setOpen(false); }}
              >
                <Plus className="h-3.5 w-3.5" />
                Создать воронку
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
