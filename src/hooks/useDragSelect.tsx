import { useState, useCallback, useEffect, useRef } from "react";

interface DragSelectOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const DRAG_THRESHOLD = 8; // pixels - minimum movement to start drag-select

export function useDragSelect<T>({ items, getItemId, onSelectionChange }: DragSelectOptions<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragStartRef = useRef<{ x: number; y: number; ctrlKey: boolean } | null>(null);
  const hasDragStartedRef = useRef(false);

  // Register item ref
  const registerItemRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      itemRefs.current.set(id, element);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  // Toggle single selection
  const toggleSelection = useCallback((id: string, ctrlKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (ctrlKey) {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      } else {
        if (next.has(id) && next.size === 1) {
          next.clear();
        } else {
          next.clear();
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  // Select all
  const selectAll = useCallback(() => {
    const allIds = new Set(items.map(getItemId));
    setSelectedIds(allIds);
  }, [items, getItemId]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Handle shift+click range selection
  const handleRangeSelect = useCallback((id: string, shiftKey: boolean) => {
    if (!shiftKey || selectedIds.size === 0) {
      toggleSelection(id, false);
      return;
    }

    const itemIds = items.map(getItemId);
    const lastSelectedId = Array.from(selectedIds).pop();
    const lastIndex = itemIds.indexOf(lastSelectedId || "");
    const currentIndex = itemIds.indexOf(id);

    if (lastIndex === -1 || currentIndex === -1) {
      toggleSelection(id, false);
      return;
    }

    const start = Math.min(lastIndex, currentIndex);
    const end = Math.max(lastIndex, currentIndex);
    const rangeIds = itemIds.slice(start, end + 1);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((itemId) => next.add(itemId));
      return next;
    });
  }, [items, getItemId, selectedIds, toggleSelection]);

  // Check if rectangle intersects with element
  const doRectsIntersect = (rect1: DOMRect, rect2: SelectionBox) => {
    const box = {
      left: Math.min(rect2.startX, rect2.endX),
      right: Math.max(rect2.startX, rect2.endX),
      top: Math.min(rect2.startY, rect2.endY),
      bottom: Math.max(rect2.startY, rect2.endY),
    };

    return !(
      rect1.right < box.left ||
      rect1.left > box.right ||
      rect1.bottom < box.top ||
      rect1.top > box.bottom
    );
  };

  // Mouse down handler - just record starting position
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start drag on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("button, input, [role=checkbox], a, [data-radix-collection-item]")) {
      return;
    }

    if (e.button !== 0) return; // Only left click

    // Record start position but don't start dragging yet
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      ctrlKey: e.ctrlKey || e.metaKey,
    };
    hasDragStartedRef.current = false;
  }, []);

  // Mouse move and up handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const dx = Math.abs(e.clientX - dragStartRef.current.x);
      const dy = Math.abs(e.clientY - dragStartRef.current.y);

      // Check if we've moved past the threshold
      if (!hasDragStartedRef.current && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        hasDragStartedRef.current = true;
        setIsDragging(true);
        
        // Clear selection if not holding ctrl
        if (!dragStartRef.current.ctrlKey) {
          setSelectedIds(new Set());
        }
        
        setSelectionBox({
          startX: dragStartRef.current.x,
          startY: dragStartRef.current.y,
          endX: e.clientX,
          endY: e.clientY,
        });
      } else if (hasDragStartedRef.current) {
        // Update selection box
        setSelectionBox((prev) => {
          if (!prev) return null;
          return { ...prev, endX: e.clientX, endY: e.clientY };
        });
      }
    };

    const handleMouseUp = () => {
      if (hasDragStartedRef.current && selectionBox) {
        // Find items that intersect with selection box (wrapped in rAF to prevent forced reflow)
        requestAnimationFrame(() => {
          const intersectingIds: string[] = [];
          
          itemRefs.current.forEach((element, id) => {
            const rect = element.getBoundingClientRect();
            if (doRectsIntersect(rect, selectionBox)) {
              intersectingIds.push(id);
            }
          });

          setSelectedIds((prev) => {
            const next = new Set(prev);
            intersectingIds.forEach((id) => next.add(id));
            return next;
          });
        });
      }

      // Reset state
      dragStartRef.current = null;
      hasDragStartedRef.current = false;
      setIsDragging(false);
      setSelectionBox(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [selectionBox]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A - select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        const activeElement = document.activeElement;
        if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();
        selectAll();
      }

      // Escape - clear selection
      if (e.key === "Escape") {
        clearSelection();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectAll, clearSelection]);

  // Notify on selection change
  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  return {
    selectedIds,
    setSelectedIds,
    isDragging,
    selectionBox,
    containerRef,
    registerItemRef,
    toggleSelection,
    handleRangeSelect,
    selectAll,
    clearSelection,
    handleMouseDown,
    selectedCount: selectedIds.size,
    hasSelection: selectedIds.size > 0,
  };
}
