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
        "group/item relative flex items-center gap-1.5 px-2.5 py-2 rounded-xl transition-all duration-200 cursor-pointer select-none",
        isActive
          ? "bg-gradient-to-r from-primary/12 to-primary/5 shadow-[inset_0_0_16px_rgba(59,130,246,0.06)]"
          : "hover:bg-muted/30 hover:shadow-sm",
        isDragging && "shadow-lg ring-1 ring-primary/20 bg-card/90 backdrop-blur-xl z-50 opacity-95"
      )}
      onClick={onSelect}
    >
      {/* Active accent dot */}
      <div className={cn(
        "absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full transition-all duration-200",
        isActive
          ? "bg-primary shadow-[0_0_6px_rgba(59,130,246,0.4)]"
          : "bg-transparent group-hover/item:bg-muted-foreground/15"
      )} />

      {/* Drag handle */}
      {canEdit && (
        <button
          className="flex-shrink-0 touch-none cursor-grab active:cursor-grabbing p-0.5 rounded-md hover:bg-muted/60 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
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
          "text-sm truncate transition-colors duration-200",
          isActive ? "font-semibold text-primary" : "font-medium text-foreground/80"
        )}>
          {pipeline.name}
        </span>
        {pipeline.is_default && (
          <Badge
            variant="secondary"
            className="flex-shrink-0 text-[9px] h-4 px-1.5 bg-gradient-to-r from-primary/20 to-primary/10 text-primary ring-1 ring-primary/20 border-0 font-semibold"
          >
            основная
          </Badge>
        )}
      </div>

      {/* Actions */}
      {canEdit && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 flex-shrink-0">
          <button
            className="h-5 w-5 flex items-center justify-center rounded-md hover:bg-muted/70 text-muted-foreground/50 hover:text-foreground transition-colors"
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
                      "h-5 w-5 flex items-center justify-center rounded-md transition-colors",
                      canDelete
                        ? "hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive"
                        : "text-muted-foreground/20 cursor-not-allowed"
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
            "inline-flex items-center gap-2 h-8 px-3.5 rounded-xl text-xs font-medium",
            "bg-gradient-to-r from-card/70 to-card/50 backdrop-blur-xl",
            "border border-border/30 ring-1 ring-primary/10",
            "hover:shadow-md hover:border-primary/25 hover:ring-primary/20",
            "transition-all duration-250 cursor-pointer select-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          )}
        >
          <span className="relative h-2 w-2 flex-shrink-0">
            <span className="absolute inset-0 rounded-full bg-primary animate-pulse opacity-40" />
            <span className="absolute inset-0.5 rounded-full bg-primary" />
          </span>
          <span className="truncate max-w-[180px] text-foreground/90">
            {activePipeline?.name || "Воронка"}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 flex-shrink-0 transition-transform duration-200" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "w-[280px] p-0 rounded-2xl overflow-hidden",
          "bg-card/75 backdrop-blur-3xl border-border/20",
          "shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
        )}
      >
        {/* Subtle gradient overlay at top */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-primary/[0.03] to-transparent pointer-events-none rounded-t-2xl" />

        <div className="relative space-y-0.5 p-2">
          {/* Header */}
          <div className="px-2.5 pt-1 pb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary/50">
              Воронки продаж
            </span>
            <div className="mt-1.5 h-px bg-gradient-to-r from-primary/20 via-border/30 to-transparent" />
          </div>

          {/* Sortable list */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedPipelines.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0.5 px-0.5">
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
              <div className="h-px bg-gradient-to-r from-transparent via-border/25 to-transparent mx-2 my-1" />
              <button
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-gradient-to-r hover:from-primary/8 hover:to-transparent transition-all duration-200"
                onClick={() => { onCreate(); setOpen(false); }}
              >
                <Plus className="h-3.5 w-3.5 text-primary/50" />
                Создать воронку
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
