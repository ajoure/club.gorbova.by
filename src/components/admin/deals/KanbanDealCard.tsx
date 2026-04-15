import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowRightLeft,
  TrendingUp,
  GripVertical,
} from "lucide-react";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import { getCardAccentColor } from "@/lib/stagePalette";

interface Props {
  deal: BoardDeal;
  onOpenDeal: (dealId: string) => void;
  isDragging?: boolean;
  onMoveClick?: (dealId: string, anchorEl: HTMLElement) => void;
  showMoveButton?: boolean;
  bulkMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (dealId: string) => void;
  stageColor?: string;
  stageType?: "open" | "closed_won" | "closed_lost";
}

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  paid: CheckCircle,
  pending: Clock,
  failed: XCircle,
  canceled: XCircle,
  refunded: XCircle,
};

const STATUS_COLORS: Record<string, string> = {
  paid: "text-green-500",
  pending: "text-amber-500",
  failed: "text-red-500",
  canceled: "text-red-400",
  refunded: "text-red-400",
};

const formatCurrency = (v: number, currency?: string | null) =>
  new Intl.NumberFormat("ru-BY", {
    style: "currency",
    currency: currency || "BYN",
    maximumFractionDigits: 0,
  }).format(v);

function isStale(deal: BoardDeal) {
  const updated = new Date(deal.updated_at || deal.created_at);
  const daysSince = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > 7;
}

function isHighValue(deal: BoardDeal) {
  return Number(deal.final_price || 0) > 500;
}

export const KanbanDealCard = memo(function KanbanDealCard({
  deal,
  onOpenDeal,
  isDragging,
  onMoveClick,
  showMoveButton,
  bulkMode,
  isSelected,
  onToggleSelect,
  stageColor,
  stageType,
}: Props) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: deal.id,
    disabled: bulkMode,
  });

  const Icon = STATUS_ICONS[deal.status] || AlertTriangle;
  const iconColor = STATUS_COLORS[deal.status] || "text-muted-foreground";

  const stale = isStale(deal);
  const highValue = isHighValue(deal);

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const handleCardClick = () => {
    if (bulkMode && onToggleSelect) {
      onToggleSelect(deal.id);
    } else {
      onOpenDeal(deal.id);
    }
  };

  // Stable left border accent from stage color — always 2px, only color changes
  const accentColor = stageColor && stageType
    ? getCardAccentColor(stageColor, stageType)
    : "transparent";

  const productName = deal.product_name || "—";
  const tariffName = deal.tariff_name;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderLeftColor: accentColor,
        borderLeftWidth: "2px",
      }}
      className={cn(
        "group relative rounded-xl border border-border/30",
        "bg-card/40 backdrop-blur-md",
        "hover:bg-card/60 hover:border-border/50",
        isDragging && "opacity-0 pointer-events-none",
        isSelected && "ring-2 ring-primary/40 bg-primary/5 border-primary/30"
      )}
    >
      {/* Drag handle — only this zone activates drag */}
      {!bulkMode && (
        <div
          {...attributes}
          {...listeners}
          className="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-60 transition-opacity z-10"
          style={{ touchAction: "none" }}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>
      )}

      {/* Card content — click opens deal or toggles selection */}
      <div
        onClick={handleCardClick}
        className={cn(
          "p-3",
          !bulkMode && "pl-5",
          bulkMode ? "cursor-pointer" : "cursor-pointer"
        )}
      >
        {/* Row 1: Deal title (product) + status icon */}
        <div className="flex items-start justify-between gap-1.5 mb-1">
          <div className="flex items-start gap-2 min-w-0">
            {bulkMode && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect?.(deal.id)}
                className="mt-0.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span className="text-xs font-medium text-foreground truncate leading-tight">
              {productName}
            </span>
          </div>
          <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", iconColor)} />
        </div>

        {/* Row 2: Tariff (if different from product) */}
        {tariffName && tariffName !== productName && (
          <div className={cn("text-[11px] text-muted-foreground/80 truncate mb-1", bulkMode && "pl-6")}>
            {tariffName}
          </div>
        )}

        {/* Row 3: Contact */}
        {(deal.contact_name || deal.contact_email) && (
          <div className={cn("text-[11px] text-muted-foreground truncate mb-1", bulkMode && "pl-6")}>
            {deal.contact_name || deal.contact_email}
          </div>
        )}

        {/* Row 4: Amount + badges */}
        <div className={cn("flex items-center gap-1.5 flex-wrap", bulkMode && "pl-6")}>
          <span className="text-sm font-semibold text-foreground">
            {formatCurrency(Number(deal.final_price || 0), deal.currency)}
          </span>

          {highValue && (
            <TrendingUp className="h-3 w-3 text-emerald-500" />
          )}
          {stale && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-600 border-amber-300">
              stale
            </Badge>
          )}
          {deal.status === "failed" && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 text-red-600 border-red-300">
              ⚠
            </Badge>
          )}
          {deal.is_trial && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 text-blue-600 border-blue-300">
              trial
            </Badge>
          )}
        </div>
      </div>

      {/* Compact move icon-button */}
      {showMoveButton && onMoveClick && !bulkMode && (
        <button
          type="button"
          title="Переместить"
          aria-label="Переместить в другую стадию"
          className={cn(
            "absolute bottom-2 right-2 flex items-center justify-center",
            "h-5 w-5",
            "text-muted-foreground/50 hover:text-foreground",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMoveClick(deal.id, e.currentTarget);
          }}
        >
          <ArrowRightLeft className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});
