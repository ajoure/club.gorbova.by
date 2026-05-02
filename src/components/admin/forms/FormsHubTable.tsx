import { useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GlassCard } from "@/components/ui/GlassCard";
import { ClipboardList, FileText, GraduationCap, User, Handshake } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
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
import { useFormsColumns } from "@/hooks/useFormsColumns";
import type { FormsHubRow } from "@/hooks/useFormsHubData";
import { ClickableContactName } from "@/components/admin/ClickableContactName";

const SOURCE_CONFIG = {
  site_form: {
    label: "Анкета",
    icon: FileText,
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  preorder: {
    label: "Предзапись",
    icon: ClipboardList,
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  training: {
    label: "Обучение",
    icon: GraduationCap,
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
} as const;

// Canonical status chip classes (matches /admin/contacts pattern):
// бледный фон + насыщенный текст + рамка той же палитры.
const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  completed:   { label: "Завершён",     className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  processed:   { label: "Обработано",   className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  in_progress: { label: "В процессе",   className: "bg-amber-50 text-amber-700 border-amber-200" },
  new:         { label: "Новый",        className: "bg-blue-50 text-blue-700 border-blue-200" },
  confirmed:   { label: "Подтверждён",  className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  contacted:   { label: "Связались",    className: "bg-sky-50 text-sky-700 border-sky-200" },
  paid:        { label: "Оплачено",     className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled:   { label: "Отменён",      className: "bg-rose-50 text-rose-700 border-rose-200" },
};

// Re-export for backwards compat
export { FORMS_DEFAULT_COLUMNS } from "@/hooks/useFormsColumns";

interface Props {
  rows: FormsHubRow[];
  isLoading: boolean;
  onOpenDetail: (row: FormsHubRow) => void;
  /** "full" — toolbar (кнопка settings снаружи) + multi-select bar.
   *  "embedded" — без bulk-bar, но с тем же DnD/resize headers. */
  variant?: "full" | "embedded";
  /** Optional: bubble up selection so parent can render FormsBulkActionsBar */
  onSelectionChange?: (selectedRows: FormsHubRow[]) => void;
  /** Reset selection signal from parent (tab switch / filter change) */
  selectionResetKey?: string;
}

export function FormsHubTable({
  rows,
  isLoading,
  onOpenDetail,
  variant = "full",
  onSelectionChange,
  selectionResetKey,
}: Props) {
  const { sortedColumns, visibleColumns, handleColumnResize, handleDragEnd } = useFormsColumns();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Selection (mixed-source row identity: source_type:id)
  const getRowKey = useCallback((r: FormsHubRow) => `${r.source_type}:${r.id}`, []);
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
    items: rows,
    getItemId: getRowKey,
  });

  // Reset selection on dataset change OR explicit parent signal
  const rowsetSig = useMemo(() => rows.map(getRowKey).join("|"), [rows, getRowKey]);
  useEffect(() => {
    clearSelection();
  }, [rowsetSig, selectionResetKey, clearSelection]);

  // Bubble up selection
  useEffect(() => {
    if (!onSelectionChange) return;
    const selected = rows.filter((r) => selectedIds.has(getRowKey(r)));
    onSelectionChange(selected);
  }, [selectedIds, rows, getRowKey, onSelectionChange]);

  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && selectedCount < rows.length;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ClipboardList className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">Нет записей по текущим фильтрам</p>
      </div>
    );
  }

  const renderCell = (col: ColumnConfig, row: FormsHubRow) => {
    const source = SOURCE_CONFIG[row.source_type];
    const Icon = source.icon;
    const status = STATUS_CONFIG[row.status] || STATUS_CONFIG.new;
    const rowKey = getRowKey(row);

    switch (col.key) {
      case "checkbox":
        return (
          <TableCell
            key={col.key}
            style={{ width: col.width }}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selectedIds.has(rowKey)}
              onCheckedChange={() => toggleSelection(rowKey, true)}
              aria-label="Выбрать строку"
            />
          </TableCell>
        );
      case "client":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <ClickableContactName
              userId={row.user_id}
              profileId={row.profile_id}
              name={row.client_name}
              fromPage="forms"
              className="text-sm truncate"
            />
          </TableCell>
        );
      case "email":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <span className="text-xs text-muted-foreground truncate block">
              {row.client_email || "—"}
            </span>
          </TableCell>
        );
      case "phone":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <span className="text-xs text-muted-foreground truncate block">
              {row.client_phone || "—"}
            </span>
          </TableCell>
        );
      case "type":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <Badge variant="outline" className={`text-[11px] gap-1 ${source.badgeClass}`}>
              <Icon className="h-3 w-3" />
              {source.label}
            </Badge>
          </TableCell>
        );
      case "product":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <span className="text-sm truncate block">{row.product_title || "—"}</span>
          </TableCell>
        );
      case "source":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <span className="text-sm text-muted-foreground truncate block">
              {row.source_entity}
            </span>
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <Badge variant="outline" className={`text-[11px] whitespace-nowrap ${status.className}`}>
              {status.label}
            </Badge>
          </TableCell>
        );
      case "created_at":
        return (
          <TableCell key={col.key} style={{ width: col.width }}>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {format(new Date(row.created_at), "dd.MM.yy", { locale: ru })}
            </span>
          </TableCell>
        );
      case "has_deal":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="text-center">
            {row.has_deal ? (
              <Handshake className="h-4 w-4 text-emerald-500 mx-auto" />
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </TableCell>
        );
      case "has_account":
        return (
          <TableCell key={col.key} style={{ width: col.width }} className="text-center">
            {row.has_account ? (
              <User className="h-4 w-4 text-blue-500 mx-auto" />
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </TableCell>
        );
      default:
        return null;
    }
  };

  const renderHead = (col: ColumnConfig) => {
    if (col.key === "checkbox") {
      return (
        <ResizableTableHead key={col.key} column={col} onResize={handleColumnResize}>
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => (v ? selectAll() : clearSelection())}
            aria-label="Выбрать все"
          />
        </ResizableTableHead>
      );
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

  const tableContent = (
    <Table wrapperClassName="contents" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
      <colgroup>
        {visibleColumns.map((col) => (
          <col key={col.key} style={{ width: `${col.width}px` }} />
        ))}
      </colgroup>
      <TableHeader>
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
        {rows.map((row) => {
          const rowKey = getRowKey(row);
          const isSelected = selectedIds.has(rowKey);
          return (
            <TableRow
              key={rowKey}
              ref={(el) => registerItemRef(rowKey, el as HTMLElement | null)}
              data-selectable-item
              data-state={isSelected ? "selected" : undefined}
              className={`cursor-pointer hover:bg-muted/50 ${isSelected ? "bg-primary/10" : ""}`}
              onClick={() => onOpenDetail(row)}
            >
              {visibleColumns.map((col) => renderCell(col, row))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const inner = (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      data-table-scroll-x="true"
      className="table-scroll-x select-none relative"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {tableContent}
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
  );

  // embedded mode → no GlassCard wrapper (parent provides container)
  if (variant === "embedded") return inner;

  return <GlassCard className="p-0 overflow-hidden">{inner}</GlassCard>;
}
