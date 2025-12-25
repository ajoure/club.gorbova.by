import { useState } from "react";
import { Plus, Loader2, Target, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useSphereGoals, SphereGoal } from "@/hooks/useSphereGoals";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SphereGoalsProps {
  sphereKey: string;
  sphereTitle: string;
}

export function SphereGoals({ sphereKey, sphereTitle }: SphereGoalsProps) {
  const { goals, loading, addGoal, updateGoal, deleteGoal, toggleComplete } = useSphereGoals(sphereKey);
  const [newGoalText, setNewGoalText] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  
  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SphereGoal | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCompleted, setEditCompleted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<string | null>(null);

  const handleAddGoal = async () => {
    if (!newGoalText.trim()) return;
    
    setIsAdding(true);
    await addGoal(newGoalText.trim(), sphereKey);
    setNewGoalText("");
    setIsAdding(false);
  };

  const handleGoalClick = (goal: SphereGoal) => {
    setEditingGoal(goal);
    setEditContent(goal.content);
    setEditCompleted(goal.completed);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingGoal || !editContent.trim()) return;
    
    setIsSaving(true);
    await updateGoal(editingGoal.id, {
      content: editContent.trim(),
      completed: editCompleted,
    });
    setIsSaving(false);
    setEditModalOpen(false);
    setEditingGoal(null);
  };

  const handleDeleteFromModal = () => {
    if (editingGoal) {
      setGoalToDelete(editingGoal.id);
      setEditModalOpen(false);
      setDeleteDialogOpen(true);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, goalId: string) => {
    e.stopPropagation();
    setGoalToDelete(goalId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (goalToDelete) {
      await deleteGoal(goalToDelete);
      setGoalToDelete(null);
      setEditingGoal(null);
    }
    setDeleteDialogOpen(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-foreground flex items-center gap-2">
        <Target className="w-4 h-4 text-primary" />
        Цели по сфере
      </h4>
      
      {/* Goals list */}
      {goals.length > 0 ? (
        <ul className="space-y-2">
          {goals.map((goal, index) => (
            <li 
              key={goal.id} 
              className="flex items-start gap-3 p-2 rounded-lg bg-muted/30 group cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleGoalClick(goal)}
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  toggleComplete(goal.id);
                }}
                className="cursor-pointer"
              >
                <Checkbox 
                  checked={goal.completed}
                  className="mt-0.5 pointer-events-none"
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${goal.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {index + 1}. {goal.content}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  handleGoalClick(goal);
                }}
              >
                <Pencil className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleDeleteClick(e, goal.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Нет целей. Добавьте первую цель ниже.
        </p>
      )}

      {/* Add new goal form */}
      <div className="flex gap-2 pt-2 border-t border-border/50">
        <Input
          placeholder="Текст цели..."
          value={newGoalText}
          onChange={(e) => setNewGoalText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddGoal()}
          className="text-sm flex-1"
        />
        <Button 
          onClick={handleAddGoal} 
          disabled={!newGoalText.trim() || isAdding}
          size="sm"
        >
          {isAdding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
        </Button>
      </div>
      
      <p className="text-[10px] text-muted-foreground">
        Цели — это стратегический уровень. Они не связаны с Матрицей продуктивности.
      </p>

      {/* Edit goal modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Редактировать цель</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="goal-content">Текст цели</Label>
              <Input
                id="goal-content"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Введите текст цели"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="goal-completed"
                checked={editCompleted}
                onCheckedChange={(checked) => setEditCompleted(checked === true)}
              />
              <Label htmlFor="goal-completed" className="cursor-pointer">Выполнено</Label>
            </div>
          </div>

          <DialogFooter className="flex gap-2 sm:justify-between">
            <Button variant="destructive" onClick={handleDeleteFromModal}>
              Удалить
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={() => setEditModalOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleSaveEdit} disabled={!editContent.trim() || isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Сохранить"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить цель?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Цель будет удалена навсегда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
