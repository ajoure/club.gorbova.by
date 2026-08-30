import { memo } from "react";
import { useNavigate } from "react-router-dom";
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
  ListChecks,
  Phone,
  MessageCircle,
  Mail,
  Video,
  CheckSquare,
  StickyNote,
  Building2,
} from "lucide-react";
import type { BoardDeal } from "@/hooks/useDealsBoard";
import type { DealTaskSummary } from "@/hooks/useDealTaskSummary";
import { getCardAccentColor } from "@/lib/stagePalette";
import { DealDragHandle } from "./DealDragHandle";

interface Props {
  deal: BoardDeal;
  onOpenDeal: (dealId: string) => void;
  onMoveClick?: (dealId: string, anchorEl: HTMLElement) => void;
  showMoveButton?: boolean;
  bulkMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (dealId: string) => void;
  stageColor?: string;
  stageType?: "open" | "closed_won" | "closed_lost";
  pipelineId?: string;
  taskSummary?: DealTaskSummary | null;
}

const TASK_TYPE_ICONS: Record<string, typeof CheckCircle> = {
  call: Phone,
  message: MessageCircle,
  email: Mail,
  meeting: Video,
  todo: CheckSquare,
  note: StickyNote,
};

function formatRelativeDue(iso: string): string {
  const due = new Date(iso).getTime();
  const diffMin = Math.round((due - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  if (abs < 60) return diffMin >= 0 ? `через ${abs}м` : `${abs}м назад`;
  const hours = Math.round(abs / 60);
  if (hours < 24) return diffMin >= 0 ? `через ${hours}ч` : `${hours}ч назад`;
  const days = Math.round(hours / 24);
  return diffMin >= 0 ? `через ${days}д` : `${days}д назад`;
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
  onMoveClick,
  showMoveButton,
  bulkMode,
  isSelected,
  onToggleSelect,
  stageColor,
  stageType,
  pipelineId,
  taskSummary,
}: Props) {
  const navigate = useNavigate();
  const Icon = STATUS_ICONS[deal.status] || AlertTriangle;
  const iconColor = STATUS_COLORS[deal.status] || "text-muted-foreground";

  const stale = isStale(deal);
  const highValue = isHighValue(deal);

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement | null;
    console.info('[KanbanCard] content-click', {
      buildFingerprint: (window as any).__BUILD_FINGERPRINT__,
      origin: window.location.origin,
      dealId: deal.id,
      pipelineId,
      stageId: deal.pipeline_stage_id,
      bulkMode,
      defaultPrevented: e.isDefaultPrevented(),
      target: target?.tagName,
      currentTarget: currentTarget?.tagName,
      targetPointerEvents: target ? window.getComputedStyle(target).pointerEvents : undefined,
      currentTargetPointerEvents: currentTarget ? window.getComputedStyle(currentTarget).pointerEvents : undefined,
      targetZIndex: target ? window.getComputedStyle(target).zIndex : undefined,
      currentTargetZIndex: currentTarget ? window.getComputedStyle(currentTarget).zIndex : undefined,
      hitContentZone: !!target?.closest('[data-kanban-deal-content]'),
      hitHandle: !!target?.closest('[data-kanban-deal-handle]'),
      hitMoveButton: !!target?.closest('[data-kanban-deal-move]'),
      hitCheckbox: !!target?.closest('[data-kanban-deal-checkbox]'),
    });
    if (bulkMode && onToggleSelect) {
      onToggleSelect(deal.id);
    } else {
      console.info('[KanbanCard] calling onOpenDeal', {
        dealId: deal.id,
        pipelineId,
        stageId: deal.pipeline_stage_id,
      });
      onOpenDeal(deal.id);
    }
  };

  const handleContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (bulkMode && onToggleSelect) {
      onToggleSelect(deal.id);
      return;
    }
    console.info('[KanbanCard] keyboard-open', {
      dealId: deal.id,
      pipelineId,
      stageId: deal.pipeline_stage_id,
    });
    onOpenDeal(deal.id);
  };

  // Stable left border accent from stage color — always 2px, only color changes
  const accentColor = stageColor && stageType
    ? getCardAccentColor(stageColor, stageType)
    : "transparent";

  const productName = deal.product_name || "—";
  const tariffName = deal.tariff_name;

  return (
    <div
      style={{
        borderLeftColor: accentColor,
        borderLeftWidth: "2px",
      }}
      className={cn(
        "relative rounded-xl border border-border/30",
        "bg-card/40",
        isSelected && "ring-2 ring-primary/40 bg-primary/5 border-primary/30"
      )}
      data-kanban-deal-card="true"
      data-deal-id={deal.id}
    >
      {!bulkMode && (
        <DealDragHandle
          dealId={deal.id}
          pipelineId={pipelineId}
          stageId={deal.pipeline_stage_id}
          className="absolute left-3 top-3 z-10"
        />
      )}
      {bulkMode && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect?.(deal.id)}
          className="absolute left-3 top-3 z-10 shrink-0"
          onClick={(e) => e.stopPropagation()}
          data-kanban-deal-checkbox="true"
        />
      )}

      <div
        onClick={handleCardClick}
        onKeyDown={handleContentKeyDown}
        role="button"
        tabIndex={0}
        data-kanban-deal-content="true"
        className={cn(
          "cursor-pointer p-3 outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          bulkMode ? "pl-10" : "pl-9",
          showMoveButton && !bulkMode && "pr-9"
        )}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-medium leading-tight text-foreground">
            {productName}
          </span>
          <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", iconColor)} />
        </div>

        {tariffName && tariffName !== productName && (
          <div className="mb-1 truncate text-[11px] text-muted-foreground/80">
            {tariffName}
          </div>
        )}

        {(deal.contact_name || deal.contact_email) && (
          <div className="mb-1 truncate text-[11px] text-muted-foreground">
            {deal.contact_name || deal.contact_email}
          </div>
        )}
        {deal.company_name && (
          <div className="mb-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{deal.company_name}</span>
          </div>
        )}
        <div className={cn("mb-1 truncate text-[11px]", deal.responsible_user_id ? "text-muted-foreground" : "text-amber-600")}>
          {deal.responsible_name || "Без менеджера"}
        </div>

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

        {taskSummary && taskSummary.open_count > 0 && (() => {
          const TypeIcon = (taskSummary.next_task_type_key && TASK_TYPE_ICONS[taskSummary.next_task_type_key]) || ListChecks;
          const overdue = (taskSummary.overdue_count ?? 0) > 0;
          const iconClr = taskSummary.next_task_type_color || (overdue ? "#dc2626" : undefined);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/admin/tasks?deal=${deal.id}`);
              }}
              className={cn(
                "mt-1.5 flex items-center gap-1 text-[10px] rounded-md px-1.5 py-0.5 border w-fit cursor-pointer hover:opacity-80 transition-opacity",
                overdue
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-border/40 bg-muted/40 text-muted-foreground"
              )}
              title="Открыть задачи по сделке"
            >
              <TypeIcon className="h-3 w-3 shrink-0" style={iconClr ? { color: iconClr } : undefined} />
              <span className="font-medium">{taskSummary.open_count}</span>
              {overdue && (
                <span className="font-semibold">· {taskSummary.overdue_count} просроч.</span>
              )}
              {taskSummary.next_due_at && !overdue && (
                <span className="opacity-80">· {formatRelativeDue(taskSummary.next_due_at)}</span>
              )}
            </button>
          );
        })()}
      </div>


      {/* Compact move icon-button */}
      {showMoveButton && onMoveClick && !bulkMode && (
        <button
          type="button"
          title="Переместить"
          aria-label="Переместить в другую стадию"
          data-kanban-deal-move="true"
          className={cn(
            "absolute bottom-2 right-2 flex items-center justify-center",
            "h-5 w-5",
            "z-10",
            "text-muted-foreground/50 hover:text-foreground",
            "opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            console.info('[KanbanCard] move-button-pointerdown', {
              dealId: deal.id,
              pipelineId,
              stageId: deal.pipeline_stage_id,
            });
          }}
          onClick={(e) => {
            e.stopPropagation();
            console.info('[KanbanCard] move-button-click', {
              dealId: deal.id,
              pipelineId,
              stageId: deal.pipeline_stage_id,
            });
            onMoveClick(deal.id, e.currentTarget);
          }}
        >
          <ArrowRightLeft className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});
