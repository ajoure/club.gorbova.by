import { useState } from "react";
import { Plus, Trash2, Loader2, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useWheelTasks, WheelTask } from "@/hooks/useWheelTasks";

interface SphereTasksProps {
  sphereKey: string;
  sphereTitle: string;
}

function getQuadrantLabel(importance: number, urgency: number): string {
  if (importance >= 6 && urgency >= 6) return "Q1: Срочно и важно";
  if (importance >= 6 && urgency < 6) return "Q2: Важно, не срочно";
  if (importance < 6 && urgency >= 6) return "Q3: Срочно, не важно";
  return "Q4: Не срочно, не важно";
}

export function SphereTasks({ sphereKey, sphereTitle }: SphereTasksProps) {
  const { tasks, loading, addTask, deleteTask, toggleComplete } = useWheelTasks(sphereKey);
  const [newTaskText, setNewTaskText] = useState("");
  const [importanceScore, setImportanceScore] = useState(5);
  const [urgencyScore, setUrgencyScore] = useState(5);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddTask = async () => {
    if (!newTaskText.trim()) return;
    
    setIsAdding(true);
    await addTask(newTaskText.trim(), sphereKey, importanceScore, urgencyScore);
    setNewTaskText("");
    setImportanceScore(5);
    setUrgencyScore(5);
    setIsAdding(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const quadrantLabel = getQuadrantLabel(importanceScore, urgencyScore);

  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-foreground flex items-center gap-2">
        <ListTodo className="w-4 h-4 text-primary" />
        Задачи по сфере
      </h4>
      
      {/* Task list */}
      {tasks.length > 0 ? (
        <ul className="space-y-2">
          {tasks.map((task, index) => (
            <li 
              key={task.id} 
              className="flex items-start gap-3 p-2 rounded-lg bg-muted/30 group"
            >
              <Checkbox 
                checked={task.completed}
                onCheckedChange={() => toggleComplete(task.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {index + 1}. {task.content}
                </span>
                <div className="flex gap-1 mt-1 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.importance_score >= 6 ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    Важность: {task.importance_score}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.urgency_score >= 6 ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                    Срочность: {task.urgency_score}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => deleteTask(task.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Нет задач. Добавьте первую задачу ниже.
        </p>
      )}

      {/* Add new task form */}
      <div className="space-y-3 pt-2 border-t border-border/50">
        <Input
          placeholder="Текст задачи..."
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
          className="text-sm"
        />
        
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-muted-foreground">Важность</Label>
              <span className="text-xs font-medium">{importanceScore}</span>
            </div>
            <Slider
              value={[importanceScore]}
              onValueChange={([val]) => setImportanceScore(val)}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-muted-foreground">Срочность</Label>
              <span className="text-xs font-medium">{urgencyScore}</span>
            </div>
            <Slider
              value={[urgencyScore]}
              onValueChange={([val]) => setUrgencyScore(val)}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
          </div>
          
          <div className="text-center">
            <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary">
              → {quadrantLabel}
            </span>
          </div>
        </div>

        <Button 
          onClick={handleAddTask} 
          disabled={!newTaskText.trim() || isAdding}
          size="sm"
          className="w-full"
        >
          {isAdding ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          Добавить задачу
        </Button>
        
        <p className="text-[10px] text-muted-foreground text-center">
          Задача автоматически появится в Матрице Эйзенхауэра
        </p>
      </div>
    </div>
  );
}