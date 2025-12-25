import { useState } from "react";
import { Plus, Trash2, Loader2, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useSphereGoals } from "@/hooks/useSphereGoals";
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
  const { goals, loading, addGoal, deleteGoal, toggleComplete } = useSphereGoals(sphereKey);
  const [newGoalText, setNewGoalText] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<string | null>(null);

  const handleAddGoal = async () => {
    if (!newGoalText.trim()) return;
    
    setIsAdding(true);
    await addGoal(newGoalText.trim(), sphereKey);
    setNewGoalText("");
    setIsAdding(false);
  };

  const handleDeleteClick = (goalId: string) => {
    setGoalToDelete(goalId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (goalToDelete) {
      await deleteGoal(goalToDelete);
      setGoalToDelete(null);
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
              className="flex items-start gap-3 p-2 rounded-lg bg-muted/30 group"
            >
              <Checkbox 
                checked={goal.completed}
                onCheckedChange={() => toggleComplete(goal.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${goal.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {index + 1}. {goal.content}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => handleDeleteClick(goal.id)}
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
        Цели — это стратегический уровень. Они не связаны с Матрицей Эйзенхауэра.
      </p>

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
