import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus } from "lucide-react";
import { TaskCategory } from "@/hooks/useTaskCategories";

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: TaskCategory[];
  onAdd: (name: string, color: string) => Promise<TaskCategory | null>;
  onDelete: (id: string) => Promise<boolean>;
}

const defaultColors = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", 
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280"
];

export function CategoryManager({
  open,
  onOpenChange,
  categories,
  onAdd,
  onDelete,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(defaultColors[0]);
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setIsAdding(true);
    await onAdd(newName.trim(), newColor);
    setNewName("");
    setNewColor(defaultColors[0]);
    setIsAdding(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Настройка сфер</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Нет созданных сфер
              </p>
            ) : (
              categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 p-2 rounded-lg border border-border">
                  <div 
                    className="w-4 h-4 rounded-full shrink-0" 
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="flex-1 text-sm">{cat.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(cat.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="border-t pt-4">
            <Label className="mb-2 block">Добавить сферу</Label>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Название"
                className="flex-1"
              />
              <div className="flex gap-1">
                {defaultColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      newColor === color ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewColor(color)}
                  />
                ))}
              </div>
            </div>
            <Button 
              className="mt-2 w-full" 
              size="sm" 
              onClick={handleAdd}
              disabled={!newName.trim() || isAdding}
            >
              <Plus className="w-4 h-4 mr-2" />
              Добавить
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
