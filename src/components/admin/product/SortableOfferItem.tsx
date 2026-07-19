import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { OfferRowCompact } from "./OfferRowCompact";
import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";
import type { TariffOffer } from "@/hooks/useTariffOffers";

interface SortableOfferItemProps {
  offer: TariffOffer;
  positionNumber: number; // 1-based visual order (#N)
  isSelected: boolean;
  onToggleSelect: () => void;
  onRowClick: (e: MouseEvent) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  /** When true, drag is blocked (e.g. a reorder RPC is in flight for this tariff). */
  disabled?: boolean;
  // OfferRowCompact passthrough
  onToggleActive: (id: string, isActive: boolean) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onSetPrimary?: (id: string) => void;
  onEdit: () => void;
  onCopy?: () => void;
  onDelete: () => void;
  hasPrimaryInTariff?: boolean;
}

export function SortableOfferItem({
  offer,
  positionNumber,
  isSelected,
  onToggleSelect,
  onRowClick,
  registerRef,
  disabled,
  onToggleActive,
  onUpdateLabel,
  onSetPrimary,
  onEdit,
  onCopy,
  onDelete,
  hasPrimaryInTariff,
}: SortableOfferItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: offer.id,
    // Attach the parent tariff so cross-tariff drops can be rejected at the
    // handler level without relying on separate DndContext boundaries alone.
    data: { tariffId: offer.tariff_id },
    disabled: disabled === true,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const slotRoleRaw = (offer.meta?.slot_role ?? "").toString().trim();
  const slotLabel = (() => {
    if (!slotRoleRaw) return "Не размещается на сайте";
    const match = /^button_(\d+)$/.exec(slotRoleRaw);
    if (match) return `Слот: Кнопка ${match[1]}`;
    return `Слот: ${slotRoleRaw}`;
  })();

  return (
    <div
      ref={(el) => { setNodeRef(el); registerRef(el); }}
      style={style}
      className={cn(
        "flex items-start gap-2 group cursor-pointer",
        isSelected && "ring-2 ring-primary/30 rounded-lg",
        isDragging && "shadow-lg",
        disabled && "opacity-70"
      )}
      onClick={onRowClick}
    >
      <div className="pt-3 pl-1 flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect()}
        />
        <button
          type="button"
          aria-label="Перетащить кнопку"
          className={cn(
            "p-1 rounded text-muted-foreground hover:text-foreground transition-colors touch-none",
            disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
          )}
          disabled={disabled === true}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded bg-muted font-medium tabular-nums">
            #{positionNumber}
          </span>
          <span>{slotLabel}</span>
        </div>
        <OfferRowCompact
          offer={offer as any}
          onToggleActive={onToggleActive}
          onUpdateLabel={onUpdateLabel}
          onSetPrimary={onSetPrimary}
          onEdit={onEdit}
          onCopy={onCopy}
          onDelete={onDelete}
          hasPrimaryInTariff={hasPrimaryInTariff}
        />
      </div>
    </div>
  );
}
