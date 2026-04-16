import { useState, useEffect, useMemo, useCallback } from "react";
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
import { ClipboardList, FileText, GraduationCap, User, Handshake } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  SortableResizableTableHead,
  ResizableTableHead,
} from "@/components/admin/table/SortableResizableTableHead";
import { ColumnSettings, type ColumnConfig } from "@/components/admin/ColumnSettings";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import type { FormsHubRow } from "@/hooks/useFormsHubData";

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

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  completed: { label: "Завершён", variant: "default" },
  processed: { label: "Обработано", variant: "default" },
  in_progress: { label: "В процессе", variant: "secondary" },
  new: { label: "Новый", variant: "outline" },
  confirmed: { label: "Подтверждён", variant: "default" },
  contacted: { label: "Связались", variant: "outline" },
  paid: { label: "Оплачено", variant: "default" },
  cancelled: { label: "Отменён", variant: "destructive" },
};

// Default columns config — canonical for /admin/forms
export const FORMS_DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "client", label: "Клиент", visible: true, width: 200, order: 1 },
  { key: "email", label: "Email", visible: true, width: 220, order: 2 },
  { key: "phone", label: "Телефон", visible: true, width: 140, order: 3 },
  { key: "type", label: "Тип", visible: true, width: 110, order: 4 },
  { key: "product", label: "Продукт", visible: true, width: 200, order: 5 },
  { key: "source", label: "Источник", visible: true, width: 180, order: 6 },
  { key: "status", label: "Статус", visible: true, width: 110, order: 7 },
  { key: "created_at", label: "Дата", visible: true, width: 110, order: 8 },
  { key: "has_deal", label: "Сделка", visible: true, width: 70, order: 9 },
  { key: "has_account", label: "Аккаунт", visible: true, width: 70, order: 10 },
];

const STORAGE_KEY = "admin_forms_columns_v1";

function loadColumns(): ColumnConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return FORMS_DEFAULT_COLUMNS;
    const parsed = JSON.parse(saved);
    return FORMS_DEFAULT_COLUMNS.map((dc) => {
      const savedCol = parsed.find((p: ColumnConfig) => p.key === dc.key);
      return savedCol ? { ...dc, ...savedCol } : dc;
    });
  } catch {
    return FORMS_DEFAULT_COLUMNS;
  }
}

interface Props {
  rows: FormsHubRow[];
  isLoading: boolean;
  onOpenDetail: (row: FormsHubRow) => void;
  /** "full" — toolbar + drag/resize/ColumnSettings/select. "embedded" — rows-only (used in By-Product groups). */
  variant?: "full" | "embedded";
}

export function FormsHubTable({ rows, isLoading, onOpenDetail, variant = "full" }: Props) {
  const [columns, setColumns] = useState<ColumnConfig[]>(() =>
    variant === "full" ? loadColumns() : FORMS_DEFAULT_COLUMNS
  );

  // Persist columns only in full mode
  useEffect(() => {
    if (variant !== "full") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  }, [columns, variant]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleColumnResize = useCallback((key: string, width: number) => {
    setColumns((cols) => cols.map((c) => (c.key === key ? { ...c, width } : c)));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumns((cols) => {
        const oldIndex = cols.findIndex((c) => c.key === active.id);
        const newIndex = cols.findIndex((c) => c.key === over.id);
        return arrayMove(cols, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
      });
    }
  }, []);

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  );

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

  // Reset selection when row dataset changes (tab switch / filter / pagination)
  // Detect via stable rowset signature
  const rowsetSig = useMemo(() => rows.map(getRowKey).join("|"), [rows, getRowKey]);
  useEffect(() => {
    clearSelection();
  }, [rowsetSig, clearSelection]);

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
            <div className="font-medium text-sm truncate">{row.client_name}</div>
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
            <Badge variant={status.variant} className="text-[11px]">
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
          {variant === "full" ? (
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={(v) => (v ? selectAll() : clearSelection())}
              aria-label="Выбрать все"
            />
          ) : null}
        </ResizableTableHead>
      );
    }

    if (variant === "embedded") {
      // Embedded mode: no drag/resize headers — plain TableHead
      return (
        <TableHead key={col.key} style={{ width: col.width }}>
          {col.label}
        </TableHead>
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

  const visibleColumns = sortedColumns.filter((c) => c.visible);

  const tableContent = (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          {variant === "full" ? (
            <SortableContext
              items={visibleColumns.map((c) => c.key)}
              strategy={horizontalListSortingStrategy}
            >
              {visibleColumns.map(renderHead)}
            </SortableContext>
          ) : (
            visibleColumns.map(renderHead)
          )}
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
              data-state={isSelected ? "selected" : undefined}
              className="cursor-pointer hover:bg-accent/40 transition-colors"
              onClick={() => onOpenDetail(row)}
            >
              {visibleColumns.map((col) => renderCell(col, row))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  if (variant === "embedded") {
    return <div className="rounded-lg border overflow-hidden">{tableContent}</div>;
  }

  return (
    <>
      <div className="flex items-center justify-end mb-2">
        <ColumnSettings columns={columns} onChange={setColumns} />
      </div>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="rounded-lg border overflow-hidden relative"
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
      <BulkActionsBar
        selectedCount={selectedCount}
        onClearSelection={clearSelection}
        onSelectAll={selectAll}
        totalCount={rows.length}
        entityName="записей"
      />
    </>
  );
}
