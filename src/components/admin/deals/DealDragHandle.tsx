import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  dealId: string;
  stageId?: string | null;
  pipelineId?: string;
  className?: string;
  disabled?: boolean;
}

export const DealDragHandle = memo(function DealDragHandle({
  dealId,
  stageId,
  pipelineId,
  className,
  disabled,
}: Props) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: dealId,
    disabled,
    data: {
      type: "deal",
      dealId,
      pipelineId: pipelineId ?? null,
      pipelineStageId: stageId ?? null,
    },
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    console.info("[DealDragHandle] pointerdown", {
      buildFingerprint: (window as any).__BUILD_FINGERPRINT__,
      origin: window.location.origin,
      dealId,
      pipelineId,
      stageId,
      target: (event.target as HTMLElement | null)?.tagName,
      currentTarget: (event.currentTarget as HTMLElement | null)?.tagName,
      targetPointerEvents: window.getComputedStyle(event.currentTarget).pointerEvents,
      targetZIndex: window.getComputedStyle(event.currentTarget).zIndex,
    });
    listeners?.onPointerDown?.(event);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
      onClick={(event) => event.stopPropagation()}
      data-kanban-deal-handle="true"
      data-deal-id={dealId}
      className={cn(
        "shrink-0 cursor-grab text-muted-foreground/40 transition-colors hover:text-muted-foreground/70 active:cursor-grabbing",
        className,
      )}
      style={{ touchAction: "none" }}
      aria-label="Перетащить сделку"
      title="Перетащить сделку"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </div>
  );
});