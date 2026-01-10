import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import {
  GripVertical,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  FolderPlus,
  RotateCcw,
} from "lucide-react";
import {
  MenuSettings,
  MenuGroup,
  MenuItem,
  MENU_ICONS,
  DEFAULT_MENU,
} from "@/hooks/useAdminMenuSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

interface MenuSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuSettings: MenuSettings;
  onSave: (settings: MenuSettings) => void;
  onReset: () => void;
  isSaving: boolean;
}

// Sortable menu item component
function SortableMenuItem({
  item,
  groupId,
  onEdit,
  onDelete,
}: {
  item: MenuItem;
  groupId: string;
  onEdit: (groupId: string, itemId: string, label: string) => void;
  onDelete: (groupId: string, itemId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.label);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `${groupId}-${item.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const IconComponent = MENU_ICONS[item.icon];

  const handleSave = () => {
    onEdit(groupId, item.id, editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(item.label);
    setIsEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-border/50 group"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {IconComponent && <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />}

      {isEditing ? (
        <div className="flex items-center gap-2 flex-1">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-7 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSave}>
            <Check className="h-4 w-4 text-green-500" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleCancel}>
            <X className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm">{item.label}</span>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              onClick={() => onDelete(groupId, item.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Sortable group component
function SortableMenuGroup({
  group,
  onEditGroup,
  onDeleteGroup,
  onEditItem,
  onDeleteItem,
  onAddItem,
}: {
  group: MenuGroup;
  onEditGroup: (groupId: string, label: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onEditItem: (groupId: string, itemId: string, label: string) => void;
  onDeleteItem: (groupId: string, itemId: string) => void;
  onAddItem: (groupId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(group.label);
  const [isOpen, setIsOpen] = useState(true);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSave = () => {
    onEditGroup(group.id, editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(group.label);
    setIsEditing(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    // Item reordering within group handled by parent
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-border rounded-xl overflow-hidden bg-card"
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="h-7 text-sm font-medium"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") handleCancel();
                }}
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSave}>
                <Check className="h-4 w-4 text-green-500" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleCancel}>
                <X className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ) : (
            <>
              <span className="flex-1 font-medium text-sm">{group.label}</span>
              <span className="text-xs text-muted-foreground">
                {group.items.length} пунктов
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => onDeleteGroup(group.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>

        <CollapsibleContent>
          <div className="p-2 space-y-1">
            <SortableContext
              items={group.items.map((item) => `${group.id}-${item.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {group.items
                .sort((a, b) => a.order - b.order)
                .map((item) => (
                  <SortableMenuItem
                    key={item.id}
                    item={item}
                    groupId={group.id}
                    onEdit={onEditItem}
                    onDelete={onDeleteItem}
                  />
                ))}
            </SortableContext>

            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2 text-muted-foreground"
              onClick={() => onAddItem(group.id)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить пункт
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Add item dialog
function AddItemDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: Partial<MenuItem>) => void;
}) {
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("/admin/");
  const [icon, setIcon] = useState("FileText");

  const handleAdd = () => {
    if (!label.trim()) return;
    onAdd({
      id: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      path,
      icon,
      order: 999,
    });
    setLabel("");
    setPath("/admin/");
    setIcon("FileText");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить пункт меню</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Название пункта"
            />
          </div>
          <div className="space-y-2">
            <Label>Путь</Label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/admin/..."
            />
          </div>
          <div className="space-y-2">
            <Label>Иконка</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(MENU_ICONS).map((iconName) => {
                  const Icon = MENU_ICONS[iconName];
                  return (
                    <SelectItem key={iconName} value={iconName}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{iconName}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleAdd} disabled={!label.trim()}>
              Добавить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MenuSettingsDialog({
  open,
  onOpenChange,
  menuSettings,
  onSave,
  onReset,
  isSaving,
}: MenuSettingsDialogProps) {
  const [localSettings, setLocalSettings] = useState<MenuSettings>(menuSettings);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [addItemGroupId, setAddItemGroupId] = useState<string | null>(null);

  // Reset local settings when dialog opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setLocalSettings(menuSettings);
    }
    onOpenChange(open);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Check if dragging groups or items
    const isGroupDrag = !activeId.includes("-");

    if (isGroupDrag) {
      // Reorder groups
      setLocalSettings((prev) => {
        const oldIndex = prev.findIndex((g) => g.id === activeId);
        const newIndex = prev.findIndex((g) => g.id === overId);
        if (oldIndex === -1 || newIndex === -1) return prev;

        const newGroups = arrayMove(prev, oldIndex, newIndex);
        return newGroups.map((g, i) => ({ ...g, order: i }));
      });
    } else {
      // Reorder items within group
      const [activeGroupId, activeItemId] = activeId.split("-");
      const [overGroupId, overItemId] = overId.split("-");

      if (activeGroupId === overGroupId) {
        setLocalSettings((prev) =>
          prev.map((group) => {
            if (group.id !== activeGroupId) return group;

            const oldIndex = group.items.findIndex((i) => i.id === activeItemId);
            const newIndex = group.items.findIndex((i) => i.id === overItemId);
            if (oldIndex === -1 || newIndex === -1) return group;

            const newItems = arrayMove(group.items, oldIndex, newIndex);
            return {
              ...group,
              items: newItems.map((item, i) => ({ ...item, order: i })),
            };
          })
        );
      }
    }
  }, []);

  const handleEditGroup = (groupId: string, label: string) => {
    setLocalSettings((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, label } : g))
    );
  };

  const handleDeleteGroup = (groupId: string) => {
    setLocalSettings((prev) => prev.filter((g) => g.id !== groupId));
  };

  const handleEditItem = (groupId: string, itemId: string, label: string) => {
    setLocalSettings((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.map((i) => (i.id === itemId ? { ...i, label } : i)),
            }
          : g
      )
    );
  };

  const handleDeleteItem = (groupId: string, itemId: string) => {
    setLocalSettings((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, items: g.items.filter((i) => i.id !== itemId) }
          : g
      )
    );
  };

  const handleAddGroup = () => {
    const newGroup: MenuGroup = {
      id: `group-${Date.now()}`,
      label: "Новый раздел",
      order: localSettings.length,
      items: [],
    };
    setLocalSettings((prev) => [...prev, newGroup]);
  };

  const handleOpenAddItem = (groupId: string) => {
    setAddItemGroupId(groupId);
    setAddItemDialogOpen(true);
  };

  const handleAddItem = (item: Partial<MenuItem>) => {
    if (!addItemGroupId) return;
    setLocalSettings((prev) =>
      prev.map((g) =>
        g.id === addItemGroupId
          ? {
              ...g,
              items: [
                ...g.items,
                {
                  id: item.id || `item-${Date.now()}`,
                  label: item.label || "Новый пункт",
                  path: item.path || "/admin",
                  icon: item.icon || "FileText",
                  order: g.items.length,
                } as MenuItem,
              ],
            }
          : g
      )
    );
  };

  const handleSave = () => {
    onSave(localSettings);
    onOpenChange(false);
  };

  const handleReset = () => {
    setLocalSettings(DEFAULT_MENU);
    onReset();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Настройка меню</DialogTitle>
          </DialogHeader>

          <ScrollArea className="h-[60vh] pr-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={localSettings.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {localSettings
                    .sort((a, b) => a.order - b.order)
                    .map((group) => (
                      <SortableMenuGroup
                        key={group.id}
                        group={group}
                        onEditGroup={handleEditGroup}
                        onDeleteGroup={handleDeleteGroup}
                        onEditItem={handleEditItem}
                        onDeleteItem={handleDeleteItem}
                        onAddItem={handleOpenAddItem}
                      />
                    ))}
                </div>
              </SortableContext>
            </DndContext>

            <Button
              variant="outline"
              className="w-full mt-4"
              onClick={handleAddGroup}
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              Добавить раздел
            </Button>
          </ScrollArea>

          <Separator />

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Сбросить
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AddItemDialog
        open={addItemDialogOpen}
        onOpenChange={setAddItemDialogOpen}
        onAdd={handleAddItem}
      />
    </>
  );
}
