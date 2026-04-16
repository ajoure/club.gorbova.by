/**
 * Shared columns state for /admin/forms — used by FormsHubTable in BOTH
 * `full` and `embedded` modes so all tables (top-level + per-product groups)
 * share one source of truth for order/widths/visibility.
 *
 * Single localStorage key: admin_forms_columns_v1
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnConfig } from "@/components/admin/ColumnSettings";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";

export const FORMS_DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "client", label: "Клиент", visible: true, width: 200, order: 1 },
  { key: "email", label: "Email", visible: true, width: 220, order: 2 },
  { key: "phone", label: "Телефон", visible: true, width: 140, order: 3 },
  { key: "type", label: "Тип", visible: true, width: 110, order: 4 },
  { key: "product", label: "Продукт", visible: true, width: 200, order: 5 },
  { key: "source", label: "Источник", visible: true, width: 180, order: 6 },
  { key: "status", label: "Статус", visible: true, width: 130, order: 7 },
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

// Cross-component sync: emit a custom event so all FormsHubTable instances
// re-read columns when one of them updates state.
const SYNC_EVENT = "forms-columns-changed";

export function useFormsColumns() {
  const [columns, setColumnsState] = useState<ColumnConfig[]>(() => loadColumns());

  // Listen for cross-instance updates
  useEffect(() => {
    const handler = () => setColumnsState(loadColumns());
    window.addEventListener(SYNC_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(SYNC_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const setColumns = useCallback((next: ColumnConfig[] | ((prev: ColumnConfig[]) => ColumnConfig[])) => {
    setColumnsState((prev) => {
      const computed = typeof next === "function" ? (next as (p: ColumnConfig[]) => ColumnConfig[])(prev) : next;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(computed));
        window.dispatchEvent(new Event(SYNC_EVENT));
      } catch {
        /* ignore quota */
      }
      return computed;
    });
  }, []);

  const handleColumnResize = useCallback(
    (key: string, width: number) => {
      setColumns((cols) => cols.map((c) => (c.key === key ? { ...c, width } : c)));
    },
    [setColumns],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setColumns((cols) => {
          const oldIndex = cols.findIndex((c) => c.key === active.id);
          const newIndex = cols.findIndex((c) => c.key === over.id);
          return arrayMove(cols, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
        });
      }
    },
    [setColumns],
  );

  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);
  const visibleColumns = useMemo(() => sortedColumns.filter((c) => c.visible), [sortedColumns]);

  return { columns, setColumns, sortedColumns, visibleColumns, handleColumnResize, handleDragEnd };
}
