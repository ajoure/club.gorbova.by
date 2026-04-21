/**
 * PATCH F-CANON: канонический table-shell для /admin/live-events.
 * Построен 1:1 на тех же reusable building blocks, что FormsHubTable:
 *  - SortableResizableTableHead / ResizableTableHead
 *  - ColumnConfig (из ColumnSettings)
 *  - useDragSelect + SelectionBox
 *  - <Table> + <colgroup> + tableLayout: fixed + width: max-content
 *  - DndContext + horizontalListSortingStrategy
 *
 * Никаких локальных «велосипедов»: вся логика данных, lifecycle, delete, sync
 * остаётся снаружи и приходит через props/коллбэки.
 */
import { useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  SortableResizableTableHead,
  ResizableTableHead,
} from "@/components/admin/table/SortableResizableTableHead";
import type { ColumnConfig } from "@/components/admin/ColumnSettings";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { useLiveEventsColumns } from "@/hooks/useLiveEventsColumns";
import { useActiveParticipants } from "@/hooks/useActiveParticipants";
import { parseRoomState, getRoomStateBadgeVM } from "@/lib/liveRoomLifecycle";
import { RoomLifecycleActions } from "@/components/live/RoomLifecycleActions";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Edit2,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Radio,
  Trash2,
  Users,
  Video,
} from "lucide-react";

// Минимальный contract эфира для таблицы (страница даёт более широкий тип).
export interface LiveEventRow {
  id: string;
  slug: string;
  title: string;
  event_type: "live_stream" | "recorded_webinar";
  is_published: boolean;
  scheduled_at: string | null;
  replay_enabled: boolean;
  platform_status: string;
  kinescope_live_event_id: string | null;
  room_state?: "closed" | "opened" | "live" | "completed" | null;
  metadata: Record<string, any> | null;
}

interface Props {
  events: LiveEventRow[];
  onEdit: (event: LiveEventRow) => void;
  onLifecycleAction: (
    eventId: string,
    action: "enable_live_event" | "complete_live_event" | "sync_live_event",
    liveEventId: string,
  ) => void;
  onDelete: (eventId: string) => void;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** Reset selection signal (filters changed). Resetting also runs on rowset signature change. */
  selectionResetKey?: string;
}

const platformStatusLabels: Record<string, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  live: "В эфире",
  ended: "Завершён",
  replay_available: "Запись доступна",
  archived: "Архив",
};

/** Единый mapper для provider-source-status (PATCH 3.7 reuse). */
function providerSourceBadge(event: LiveEventRow) {
  const meta = event.metadata as any;
  const pss = meta?.provider_source_status;
  if (event.event_type !== "live_stream") {
    return (
      <Badge variant="outline" className="text-[10px]">
        {platformStatusLabels[event.platform_status] || event.platform_status}
      </Badge>
    );
  }
  if (!event.kinescope_live_event_id && !pss) {
    return <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">⚪ Не создан</Badge>;
  }
  if (pss === "missing") {
    return <Badge variant="destructive" className="text-[10px]">🔴 Удалён</Badge>;
  }
  if (pss === "broken") {
    return <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30">🟡 Повреждён</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">🟢 Активен</Badge>;
}

function ActiveCell({ eventId }: { eventId: string }) {
  const { data } = useActiveParticipants(eventId, true);
  return (
    <span className="text-sm tabular-nums" title="Активные участники за последние 2 минуты">
      {typeof data === "number" ? data : "—"}
    </span>
  );
}

function RoomStateCell({ event }: { event: LiveEventRow }) {
  const state = parseRoomState(event.room_state);
  const vm = getRoomStateBadgeVM(state);
  const { data: activeCount } = useActiveParticipants(event.id, state === "opened" || state === "live");
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={vm.variant} className={vm.pulse ? "animate-pulse" : ""}>
        {vm.shortLabel}
      </Badge>
      {(state === "opened" || state === "live") && typeof activeCount === "number" && (
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1" title="Активные за 2 мин">
          <Users className="h-3 w-3" /> {activeCount}
        </span>
      )}
    </div>
  );
}

export function LiveEventsTable({
  events,
  onEdit,
  onLifecycleAction,
  onDelete,
  onSelectionChange,
  selectionResetKey,
}: Props) {
  const { visibleColumns, handleColumnResize, handleDragEnd } = useLiveEventsColumns();

  // PATCH: explicit total width = sum of visible column widths.
  // tableLayout:fixed + width:max-content alone не давал корректную итоговую ширину
  // в текущем admin-shell — таблица растягивалась под viewport, scroll не активировался.
  const totalTableWidth = useMemo(
    () => visibleColumns.reduce((sum, col) => sum + (col.width ?? 120), 0),
    [visibleColumns],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const getRowKey = useCallback((e: LiveEventRow) => e.id, []);
  const {
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
    handleMouseDown,
    isDragging,
    selectionBox,
    containerRef,
    registerItemRef,
    selectedCount,
  } = useDragSelect({
    items: events,
    getItemId: getRowKey,
  });

  // Robust reset: signature по реальным id, не только по длине.
  const rowsetSig = useMemo(() => events.map(getRowKey).join("|"), [events, getRowKey]);
  useEffect(() => {
    clearSelection();
  }, [rowsetSig, selectionResetKey, clearSelection]);

  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  const allSelected = events.length > 0 && selectedCount === events.length;
  const someSelected = selectedCount > 0 && selectedCount < events.length;

  const renderHead = (col: ColumnConfig) => {
    if (col.key === "checkbox") {
      return (
        <ResizableTableHead key={col.key} column={col} onResize={handleColumnResize}>
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => (v ? selectAll() : clearSelection())}
            aria-label="Выбрать все на странице"
          />
        </ResizableTableHead>
      );
    }
    if (col.key === "actions") {
      return <ResizableTableHead key={col.key} column={col} onResize={handleColumnResize}>{null}</ResizableTableHead>;
    }
    return (
      <SortableResizableTableHead
        key={col.key}
        id={col.key}
        column={col}
        onResize={handleColumnResize}
      >
        {col.label}
      </SortableResizableTableHead>
    );
  };

  const renderCell = (col: ColumnConfig, event: LiveEventRow) => {
    const isSelected = selectedIds.has(event.id);
    switch (col.key) {
      case "checkbox":
        return (
          <TableCell key={col.key} style={{ width: col.width }} onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelection(event.id, true)}
              aria-label={`Выбрать ${event.title}`}
            />
          </TableCell>
        );
      case "title":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="font-medium">
            <div className="truncate" title={event.title}>{event.title}</div>
            <div className="text-xs text-muted-foreground truncate" title={event.slug}>{event.slug}</div>
          </TableCell>
        );
      case "type":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <Badge variant={event.event_type === "live_stream" ? "default" : "secondary"} className="text-[10px]">
              {event.event_type === "live_stream" ? (
                <><Radio className="h-3 w-3 mr-1" />Живой</>
              ) : (
                <><Video className="h-3 w-3 mr-1" />Видео</>
              )}
            </Badge>
          </TableCell>
        );
      case "room_state":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <RoomStateCell event={event} />
          </TableCell>
        );
      case "provider":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <Tooltip>
              <TooltipTrigger asChild><span>{providerSourceBadge(event)}</span></TooltipTrigger>
              <TooltipContent>Источник видео (provider)</TooltipContent>
            </Tooltip>
          </TableCell>
        );
      case "published":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            {event.is_published ? <Badge variant="default">Да</Badge> : <Badge variant="outline">Нет</Badge>}
          </TableCell>
        );
      case "scheduled_at":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="text-sm text-muted-foreground whitespace-nowrap">
            {event.scheduled_at ? format(new Date(event.scheduled_at), "dd.MM.yyyy HH:mm", { locale: ru }) : "—"}
          </TableCell>
        );
      case "participants":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="text-center">
            <ActiveCell eventId={event.id} />
          </TableCell>
        );
      case "replay":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            {event.replay_enabled ? (
              <Badge variant="outline" className="text-[10px]">Доступна</Badge>
            ) : (
              <span className="text-muted-foreground text-xs">—</span>
            )}
          </TableCell>
        );
      case "lifecycle":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <RoomLifecycleActions
              eventId={event.id}
              roomState={parseRoomState(event.room_state)}
              layout="admin"
            />
          </TableCell>
        );
      case "actions":
        return (
          <TableCell key={col.key} style={{ width: col.width }} onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onEdit(event)}>
                  <Edit2 className="h-4 w-4 mr-2" />Редактировать
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/live/${event.slug}`, "_blank")}>
                  <ExternalLink className="h-4 w-4 mr-2" />Открыть страницу
                </DropdownMenuItem>
                {event.event_type === "live_stream" && event.kinescope_live_event_id && (
                  <DropdownMenuItem
                    onClick={() => onLifecycleAction(event.id, "sync_live_event", event.kinescope_live_event_id!)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />Синхронизировать Kinescope
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(event.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />Удалить…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        );
      default:
        return null;
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="rounded-md border bg-card">
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          className="overflow-x-auto select-none relative live-events-table-scroll rounded-md"
          style={{
            scrollbarWidth: "auto",
            scrollbarColor: "hsl(var(--muted-foreground) / 0.4) transparent",
          }}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <colgroup>
                {visibleColumns.map((col) => (
                  <col key={col.key} style={{ width: `${col.width}px` }} />
                ))}
              </colgroup>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <SortableContext
                    items={visibleColumns.map((c) => c.key)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {visibleColumns.map(renderHead)}
                  </SortableContext>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const isSelected = selectedIds.has(event.id);
                  return (
                    <TableRow
                      key={event.id}
                      ref={(el) => registerItemRef(event.id, el as HTMLElement | null)}
                      data-selectable-item
                      data-state={isSelected ? "selected" : undefined}
                      className={`cursor-default hover:bg-muted/50 ${isSelected ? "bg-primary/10" : ""}`}
                      onDoubleClick={() => onEdit(event)}
                    >
                      {visibleColumns.map((col) => renderCell(col, event))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DndContext>
          {isDragging && selectionBox && (
            <SelectionBox
              startX={selectionBox.startX}
              startY={selectionBox.startY}
              endX={selectionBox.endX}
              endY={selectionBox.endY}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
