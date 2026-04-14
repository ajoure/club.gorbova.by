import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowRightLeft,
  TrendingUp,
} from "lucide-react";
import type { BoardDeal } from "@/hooks/useDealsBoard";

interface Props {
  deal: BoardDeal;
  onOpenDeal: (dealId: string) => void;
  isDragging?: boolean;
  onMoveClick?: (dealId: string, anchorEl: HTMLElement) => void;
  showMoveButton?: boolean;
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

export const KanbanDealCard = memo(function KanbanDealCard({ deal, onOpenDeal, isDragging, onMoveClick, showMoveButton }: Props) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: deal.id,
  });

  const Icon = STATUS_ICONS[deal.status] || AlertTriangle;
  const iconColor = STATUS_COLORS[deal.status] || "text-muted-foreground";

  const stale = isStale(deal);
  const highValue = isHighValue(deal);

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-xl border border-border/30 transition-all duration-150",
        "bg-card/40 backdrop-blur-md hover:bg-card/60 hover:shadow-md hover:border-border/50",
        isDragging && "opacity-0 pointer-events-none",
        stale && "border-l-2 border-l-amber-400"
      )}
    >
      {/* Drag handle zone */}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => {
          if (!isDragging) onOpenDeal(deal.id);
        }}
        className="p-3 cursor-grab active:cursor-grabbing"
      >
        {/* Top row: product + status */}
        <div className="flex items-start justify-between gap-1.5 mb-1.5">
          <span className="text-xs font-medium text-foreground truncate leading-tight">
            {deal.product_name || "—"}
          </span>
          <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", iconColor)} />
        </div>

        {/* Contact */}
        {(deal.contact_name || deal.contact_email) && (
          <div className="text-[11px] text-muted-foreground truncate mb-1">
            {deal.contact_name || deal.contact_email}
          </div>
        )}

        {/* Amount + badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
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

        {/* Order number */}
        <div className={cn("text-[10px] text-muted-foreground/60 mt-1 font-mono", showMoveButton && "pr-6")}>
          {deal.order_number}
        </div>
      </div>

      {/* Compact move icon-button — simple button, no portal/dropdown */}
      {showMoveButton && onMoveClick && (
        <button
          type="button"
          title="Переместить"
          aria-label="Переместить в другую стадию"
          className={cn(
            "absolute bottom-2 right-2 flex items-center justify-center",
            "h-3 w-3 min-w-[24px] min-h-[24px]",
            "text-muted-foreground/50 hover:text-foreground",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
            "touch-action-manipulation"
          )}
          style={{ touchAction: "manipulation" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMoveClick(deal.id, e.currentTarget);
          }}
        >
          <ArrowRightLeft className="h-2 w-2" />
        </button>
      )}
    </div>
  );
});
