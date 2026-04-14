import { useDraggable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
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
import type { CrmPipelineStage } from "@/services/pipelineService";

interface Props {
  deal: BoardDeal;
  onOpen: () => void;
  isDragging?: boolean;
  onMoveTo?: (stageId: string) => void;
  availableStages?: CrmPipelineStage[];
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

export function KanbanDealCard({ deal, onOpen, isDragging, onMoveTo, availableStages }: Props) {
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

  const showMoveButton = onMoveTo && availableStages && availableStages.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-xl border border-border/30 transition-all duration-150",
        "bg-card/40 backdrop-blur-md hover:bg-card/60 hover:shadow-md hover:border-border/50",
        isDragging && "shadow-xl scale-105 opacity-80",
        stale && "border-l-2 border-l-amber-400"
      )}
    >
      {/* Drag handle zone */}
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => {
          if (!isDragging) onOpen();
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

        {/* Order number — with right padding so move button doesn't overlap */}
        <div className={cn("text-[10px] text-muted-foreground/60 mt-1 font-mono", showMoveButton && "pr-7")}>
          {deal.order_number}
        </div>
      </div>

      {/* Compact move icon-button — absolute positioned, no layout impact */}
      {showMoveButton && (
        <div
          className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground"
                      aria-label="Переместить в другую стадию"
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  Переместить
                </TooltipContent>
                <DropdownMenuContent align="end" side="bottom" className="w-48">
                  {availableStages!.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => onMoveTo!(s.id)}
                    >
                      <div
                        className="w-2 h-2 rounded-full mr-2 shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
