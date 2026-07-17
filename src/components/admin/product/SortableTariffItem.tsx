import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { TariffCardCompact } from "./TariffCardCompact";
import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";

interface TariffOffer {
  id: string;
  offer_type: "pay_now" | "trial" | "preregistration" | "lead" | "bank_installment" | "invoice";
  button_label: string;
  amount: number;
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  is_active: boolean;
  is_primary?: boolean;
}

interface SortableTariffItemProps {
  tariff: any;
  offers: TariffOffer[];
  productIsActive: boolean;
  isSelected: boolean;
  isDragPending: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClick: (e: MouseEvent) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

export function SortableTariffItem({
  tariff,
  offers,
  productIsActive,
  isSelected,
  isDragPending,
  onToggleSelect,
  onEdit,
  onDelete,
  onClick,
  registerRef,
}: SortableTariffItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tariff.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={(el) => { setNodeRef(el); registerRef(el); }}
      style={style}
      className={cn(
        "flex items-start gap-2 group cursor-pointer",
        isSelected && "ring-2 ring-primary/30 rounded-xl",
        isDragging && "shadow-lg"
      )}
      onClick={onClick}
    >
      <div className="pt-4 pl-1 flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect()}
        />
        <button
          type="button"
          className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
        <TariffCardCompact
          tariff={tariff}
          offers={offers}
          productIsActive={productIsActive}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
