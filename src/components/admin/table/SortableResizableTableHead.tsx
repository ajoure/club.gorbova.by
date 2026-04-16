import * as React from "react";
import { TableHead } from "@/components/ui/table";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ColumnConfig } from "@/components/admin/ColumnSettings";

/**
 * Shared table head primitives — extracted from AdminContacts.tsx (PATCH 2A).
 * Used by both /admin/contacts and /admin/forms to ensure single canonical table engine.
 *
 * Behavior contract MUST remain identical to original local definitions in AdminContacts.
 */

interface SortableResizableTableHeadProps {
  column: ColumnConfig;
  onResize: (key: string, width: number) => void;
  children: React.ReactNode;
  className?: string;
  id: string;
}

export function SortableResizableTableHead({
  column,
  onResize,
  children,
  className,
  id,
}: SortableResizableTableHeadProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = column.width;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      onResize(column.key, newWidth);
    };

    const handleMouseUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: column.width,
    minWidth: 60,
    position: "relative" as const,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableHead ref={setNodeRef} style={style} className={className}>
      <div className="flex items-center gap-1">
        <div
          {...attributes}
          {...listeners}
          data-drag-handle
          className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted rounded opacity-50 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3 h-3" />
        </div>
        <div className="flex-1">{children}</div>
      </div>
      <div
        data-resize-handle
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors z-10"
        onMouseDown={handleMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </TableHead>
  );
}

interface ResizableTableHeadProps {
  column: ColumnConfig;
  onResize: (key: string, width: number) => void;
  children: React.ReactNode;
  className?: string;
}

export function ResizableTableHead({
  column,
  children,
  className,
}: ResizableTableHeadProps) {
  return (
    <TableHead
      style={{ width: column.width, minWidth: 60, position: "relative" }}
      className={className}
    >
      {children}
    </TableHead>
  );
}
