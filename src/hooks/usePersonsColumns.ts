/**
 * Канонические колонки для таблицы «Физлица» (раздел «Реквизиты»).
 * Зеркало useEntitiesColumns / useLiveEventsColumns.
 *
 * LocalStorage key: ai_persons_columns_v1
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnConfig } from "@/components/admin/ColumnSettings";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";

export const PERSONS_DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "ФИО", visible: true, width: 280, order: 0 },
  { key: "document", label: "Документ", visible: true, width: 200, order: 1 },
  { key: "phone", label: "Телефон", visible: true, width: 160, order: 2 },
  { key: "email", label: "Email", visible: true, width: 220, order: 3 },
  { key: "status", label: "Статус", visible: true, width: 120, order: 4 },
];

/** Физлица сейчас не имеют action-кнопок в строке — locked-список пуст. */
export const PERSONS_LOCKED_KEYS = new Set<string>();

const STORAGE_KEY = "ai_persons_columns_v1";
const SYNC_EVENT = "ai-persons-columns-changed";

function loadColumns(): ColumnConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return PERSONS_DEFAULT_COLUMNS;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return PERSONS_DEFAULT_COLUMNS;

    const merged = PERSONS_DEFAULT_COLUMNS.map((dc) => {
      const savedCol = parsed.find((p: any) => p && p.key === dc.key);
      if (!savedCol) return { ...dc };
      const widthValid =
        typeof savedCol.width === "number" && Number.isFinite(savedCol.width) && savedCol.width > 0;
      const orderValid = typeof savedCol.order === "number" && Number.isFinite(savedCol.order);
      const visible = PERSONS_LOCKED_KEYS.has(dc.key)
        ? true
        : typeof savedCol.visible === "boolean"
          ? savedCol.visible
          : dc.visible;
      return {
        ...dc,
        width: widthValid ? savedCol.width : dc.width,
        order: orderValid ? savedCol.order : dc.order,
        visible,
      };
    });

    return merged
      .sort((a, b) => a.order - b.order)
      .map((c, i) => ({ ...c, order: i }));
  } catch {
    return PERSONS_DEFAULT_COLUMNS;
  }
}

export function usePersonsColumns() {
  const [columns, setColumnsState] = useState<ColumnConfig[]>(() => loadColumns());

  useEffect(() => {
    const handler = () => setColumnsState(loadColumns());
    window.addEventListener(SYNC_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(SYNC_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const setColumns = useCallback(
    (next: ColumnConfig[] | ((prev: ColumnConfig[]) => ColumnConfig[])) => {
      setColumnsState((prev) => {
        const computed =
          typeof next === "function" ? (next as (p: ColumnConfig[]) => ColumnConfig[])(prev) : next;
        const guarded = computed.map((c) =>
          PERSONS_LOCKED_KEYS.has(c.key) ? { ...c, visible: true } : c,
        );
        const visibleNonLocked = guarded.filter(
          (c) => !PERSONS_LOCKED_KEYS.has(c.key) && c.visible,
        );
        const finalCols =
          visibleNonLocked.length === 0
            ? guarded.map((c, i) =>
                !PERSONS_LOCKED_KEYS.has(c.key) && i === 0 ? { ...c, visible: true } : c,
              )
            : guarded;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(finalCols));
          window.dispatchEvent(new Event(SYNC_EVENT));
        } catch {
          /* ignore quota */
        }
        return finalCols;
      });
    },
    [],
  );

  const handleColumnResize = useCallback(
    (key: string, width: number) => {
      setColumns((cols) => cols.map((c) => (c.key === key ? { ...c, width } : c)));
    },
    [setColumns],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      if (PERSONS_LOCKED_KEYS.has(String(active.id))) return;
      if (PERSONS_LOCKED_KEYS.has(String(over.id))) return;
      setColumns((cols) => {
        const oldIndex = cols.findIndex((c) => c.key === active.id);
        const newIndex = cols.findIndex((c) => c.key === over.id);
        if (oldIndex < 0 || newIndex < 0) return cols;
        return arrayMove(cols, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
      });
    },
    [setColumns],
  );

  const resetColumns = useCallback(() => {
    setColumns(PERSONS_DEFAULT_COLUMNS);
  }, [setColumns]);

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns],
  );
  const visibleColumns = useMemo(
    () => sortedColumns.filter((c) => c.visible),
    [sortedColumns],
  );

  return {
    columns,
    setColumns,
    sortedColumns,
    visibleColumns,
    handleColumnResize,
    handleDragEnd,
    resetColumns,
  };
}
