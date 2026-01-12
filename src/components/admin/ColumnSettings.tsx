import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Settings2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  order: number;
}

interface ColumnSettingsProps {
  columns: ColumnConfig[];
  onChange: (columns: ColumnConfig[]) => void;
}

interface SortableItemProps {
  column: ColumnConfig;
  onToggle: (key: string, visible: boolean) => void;
}

function SortableItem({ column, onToggle }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Skip checkbox column from settings
  if (column.key === "checkbox") return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/50"
    >
      <button
        className="cursor-grab hover:bg-muted p-0.5 rounded"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <Checkbox
        id={`col-${column.key}`}
        checked={column.visible}
        onCheckedChange={(checked) => onToggle(column.key, !!checked)}
      />
      <label
        htmlFor={`col-${column.key}`}
        className="text-sm cursor-pointer flex-1"
      >
        {column.label || column.key}
      </label>
    </div>
  );
}

export function ColumnSettings({ columns, onChange }: ColumnSettingsProps) {
  const [open, setOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleToggle = (key: string, visible: boolean) => {
    const updated = columns.map((col) =>
      col.key === key ? { ...col, visible } : col
    );
    onChange(updated);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = columns.findIndex((col) => col.key === active.id);
    const newIndex = columns.findIndex((col) => col.key === over.id);

    const reordered = arrayMove(columns, oldIndex, newIndex).map(
      (col, index) => ({
        ...col,
        order: index,
      })
    );

    onChange(reordered);
  };

  const visibleColumns = columns.filter((c) => c.key !== "checkbox");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="w-3.5 h-3.5" />
          Колонки
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
          Перетащите для изменения порядка
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleColumns.map((c) => c.key)}
            strategy={verticalListSortingStrategy}
          >
            {visibleColumns
              .sort((a, b) => a.order - b.order)
              .map((column) => (
                <SortableItem
                  key={column.key}
                  column={column}
                  onToggle={handleToggle}
                />
              ))}
          </SortableContext>
        </DndContext>
      </PopoverContent>
    </Popover>
  );
}
