/**
 * PATCH F-CANON: shared columns state для /admin/live-events.
 * Тонкая адаптация useFormsColumns — тот же localStorage/event/contract.
 *
 * Service columns (`checkbox`, `actions`) не скрываются и не перетаскиваются —
 * это защищено через LOCKED_KEYS (фильтруются из ColumnSettings popover в UI-обёртке).
 *
 * Single localStorage key: admin_live_events_columns_v1
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnConfig } from "@/components/admin/ColumnSettings";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";

export const LIVE_EVENTS_DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "title", label: "Название", visible: true, width: 280, order: 1 },
  { key: "type", label: "Тип", visible: true, width: 110, order: 2 },
  { key: "room_state", label: "Комната", visible: true, width: 140, order: 3 },
  { key: "provider", label: "Источник", visible: true, width: 140, order: 4 },
  { key: "published", label: "Опубликован", visible: true, width: 110, order: 5 },
  { key: "scheduled_at", label: "Дата", visible: true, width: 160, order: 6 },
  { key: "participants", label: "Активные", visible: true, width: 90, order: 7 },
  { key: "replay", label: "Запись", visible: true, width: 100, order: 8 },
  { key: "lifecycle", label: "Lifecycle", visible: true, width: 200, order: 9 },
  { key: "actions", label: "", visible: true, width: 60, order: 10 },
];

/** Колонки, которые нельзя скрыть/перетащить в произвольное место. */
export const LIVE_EVENTS_LOCKED_KEYS = new Set(["checkbox", "actions"]);

const STORAGE_KEY = "admin_live_events_columns_v1";
const SYNC_EVENT = "live-events-columns-changed";

function loadColumns(): ColumnConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return LIVE_EVENTS_DEFAULT_COLUMNS;
    const parsed = JSON.parse(saved);
    return LIVE_EVENTS_DEFAULT_COLUMNS.map((dc) => {
      const savedCol = parsed.find((p: ColumnConfig) => p.key === dc.key);
      // Locked keys: всегда visible (защита от поломанного localStorage)
      if (LIVE_EVENTS_LOCKED_KEYS.has(dc.key)) {
        return savedCol ? { ...dc, ...savedCol, visible: true } : dc;
      }
      return savedCol ? { ...dc, ...savedCol } : dc;
    });
  } catch {
    return LIVE_EVENTS_DEFAULT_COLUMNS;
  }
}

export function useLiveEventsColumns() {
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
        const computed = typeof next === "function" ? (next as (p: ColumnConfig[]) => ColumnConfig[])(prev) : next;
        // Forced visibility on locked columns
        const guarded = computed.map((c) =>
          LIVE_EVENTS_LOCKED_KEYS.has(c.key) ? { ...c, visible: true } : c,
        );
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(guarded));
          window.dispatchEvent(new Event(SYNC_EVENT));
        } catch {
          /* ignore quota */
        }
        return guarded;
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
      // Locked columns не двигаются
      if (LIVE_EVENTS_LOCKED_KEYS.has(String(active.id))) return;
      if (LIVE_EVENTS_LOCKED_KEYS.has(String(over.id))) return;
      setColumns((cols) => {
        const oldIndex = cols.findIndex((c) => c.key === active.id);
        const newIndex = cols.findIndex((c) => c.key === over.id);
        if (oldIndex < 0 || newIndex < 0) return cols;
        return arrayMove(cols, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
      });
    },
    [setColumns],
  );

  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);
  const visibleColumns = useMemo(() => sortedColumns.filter((c) => c.visible), [sortedColumns]);

  return { columns, setColumns, sortedColumns, visibleColumns, handleColumnResize, handleDragEnd };
}
