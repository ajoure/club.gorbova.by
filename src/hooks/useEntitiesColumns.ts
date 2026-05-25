/**
 * Канонические колонки для таблицы «Юрлица / ИП» (раздел «Реквизиты»).
 * Зеркало useLiveEventsColumns: тот же контракт (sortedColumns / visibleColumns /
 * handleColumnResize / handleDragEnd), тот же sync-через-event подход,
 * та же защита locked-колонки `actions`.
 *
 * LocalStorage key: ai_entities_columns_v1
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnConfig } from "@/components/admin/ColumnSettings";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";

export const ENTITIES_DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Название", visible: true, width: 320, order: 0 },
  { key: "type", label: "Тип", visible: true, width: 90, order: 1 },
  { key: "unp", label: "УНП", visible: true, width: 140, order: 2 },
  { key: "status", label: "Статус", visible: true, width: 120, order: 3 },
  { key: "actions", label: "Действия", visible: true, width: 160, order: 4 },
];

/** Колонки, которые нельзя скрыть/перетащить — всегда последние/первые и всегда видимые. */
export const ENTITIES_LOCKED_KEYS = new Set(["actions"]);

const STORAGE_KEY = "ai_entities_columns_v1";
const SYNC_EVENT = "ai-entities-columns-changed";

function loadColumns(): ColumnConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return ENTITIES_DEFAULT_COLUMNS;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return ENTITIES_DEFAULT_COLUMNS;

    const merged = ENTITIES_DEFAULT_COLUMNS.map((dc) => {
      const savedCol = parsed.find((p: any) => p && p.key === dc.key);
      if (!savedCol) return { ...dc };
      const widthValid =
        typeof savedCol.width === "number" && Number.isFinite(savedCol.width) && savedCol.width > 0;
      const orderValid = typeof savedCol.order === "number" && Number.isFinite(savedCol.order);
      const visible = ENTITIES_LOCKED_KEYS.has(dc.key)
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

    // Re-sort, but принудительно загоняем actions в конец
    const sorted = [...merged].sort((a, b) => a.order - b.order);
    const nonLocked = sorted.filter((c) => !ENTITIES_LOCKED_KEYS.has(c.key));
    const locked = sorted.filter((c) => ENTITIES_LOCKED_KEYS.has(c.key));
    return [...nonLocked, ...locked].map((c, i) => ({ ...c, order: i }));
  } catch {
    return ENTITIES_DEFAULT_COLUMNS;
  }
}

export function useEntitiesColumns() {
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
        // Guard: locked columns всегда visible
        const guarded = computed.map((c) =>
          ENTITIES_LOCKED_KEYS.has(c.key) ? { ...c, visible: true } : c,
        );
        // Guard: хотя бы одна нелокированная колонка должна остаться видимой
        const visibleNonLocked = guarded.filter(
          (c) => !ENTITIES_LOCKED_KEYS.has(c.key) && c.visible,
        );
        const finalCols =
          visibleNonLocked.length === 0
            ? guarded.map((c, i) =>
                !ENTITIES_LOCKED_KEYS.has(c.key) && i === 0 ? { ...c, visible: true } : c,
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
      if (ENTITIES_LOCKED_KEYS.has(String(active.id))) return;
      if (ENTITIES_LOCKED_KEYS.has(String(over.id))) return;
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
    setColumns(ENTITIES_DEFAULT_COLUMNS);
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
