import { useState } from "react";
import { Plus, Loader2, ListTodo, X, Sparkles, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWheelTasks, WheelTask } from "@/hooks/useWheelTasks";
import { TaskEditModal } from "@/components/eisenhower/TaskEditModal";
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

interface SphereTasksProps {
  sphereKey: string;
  sphereTitle: string;
}

const quadrantLabels: Record<string, string> = {
  "urgent-important": "Q1",
  "not-urgent-important": "Q2",
  "urgent-not-important": "Q3",
  "not-urgent-not-important": "Q4",
  "planned": "Планируемая",
};

export function SphereTasks({ sphereKey, sphereTitle }: SphereTasksProps) {
  const { tasks, loading, addTask, deleteTask, toggleComplete, updateTask } = useWheelTasks(sphereKey);
  const [newTaskText, setNewTaskText] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  
  // Task edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WheelTask | null>(null);
  
  // New task modal state (expanded creation)
  const [newTaskModalOpen, setNewTaskModalOpen] = useState(false);
  
  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  const handleAddTask = async () => {
    if (!newTaskText.trim()) return;
    
    setIsAdding(true);
    // Create task without importance/urgency - will go to "planned" status
    await addTask(newTaskText.trim(), sphereKey);
    setNewTaskText("");
    setIsAdding(false);
  };

  const handleTaskClick = (task: WheelTask) => {
    setSelectedTask(task);
    setEditModalOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (taskToDelete) {
      await deleteTask(taskToDelete);
      setTaskToDelete(null);
    }
    setDeleteDialogOpen(false);
  };

  const handleSaveTask = async (updates: {
    content: string;
    quadrant: string | null;
    completed: boolean;
    deadline_date: string | null;
    deadline_time: string | null;
    category_id: string | null;
    importance: number;
    urgency: number;
  }) => {
    if (!selectedTask) return;
    
    await updateTask(selectedTask.id, {
      content: updates.content,
      importance_score: updates.importance,
      urgency_score: updates.urgency,
      completed: updates.completed,
    });
    
    setEditModalOpen(false);
    setSelectedTask(null);
  };

  const handleDeleteFromModal = async () => {
    if (selectedTask) {
      await deleteTask(selectedTask.id);
      setEditModalOpen(false);
      setSelectedTask(null);
    }
  };

  const handleSaveNewTask = async (updates: {
    content: string;
    quadrant: string | null;
    completed: boolean;
    deadline_date: string | null;
    deadline_time: string | null;
    category_id: string | null;
    importance: number;
    urgency: number;
  }) => {
    if (!updates.content.trim()) return;
    
    // Create task via addTask - it will sync with Productivity Matrix
    await addTask(updates.content.trim(), sphereKey);
    
    // TODO: If there's a linked eisenhower task, update it with deadline/quadrant
    setNewTaskModalOpen(false);
  };

  // Map wheel task to format expected by TaskEditModal
  const getTaskForModal = (task: WheelTask) => {
    // Determine quadrant from importance/urgency scores
    let quadrant = "planned";
    if (task.importance_score >= 6 && task.urgency_score >= 6) quadrant = "urgent-important";
    else if (task.importance_score >= 6 && task.urgency_score < 6) quadrant = "not-urgent-important";
    else if (task.importance_score < 6 && task.urgency_score >= 6) quadrant = "urgent-not-important";
    else if (task.importance_score < 6 && task.urgency_score < 6 && (task.importance_score > 5 || task.urgency_score > 5)) quadrant = "not-urgent-not-important";

    return {
      id: task.id,
      content: task.content,
      quadrant,
      completed: task.completed,
      deadline_date: null,
      deadline_time: null,
      category_id: null,
      importance: task.importance_score,
      urgency: task.urgency_score,
    };
  };

  const getQuadrantBadge = (task: WheelTask) => {
    if (task.importance_score >= 6 && task.urgency_score >= 6) return "Q1";
    if (task.importance_score >= 6 && task.urgency_score < 6) return "Q2";
    if (task.importance_score < 6 && task.urgency_score >= 6) return "Q3";
    if (task.importance_score < 6 && task.urgency_score < 6) return "Q4";
    return "—";
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
        <ListTodo className="w-4 h-4 text-primary" />
        Задачи по сфере
      </h4>
      
      {/* Task list */}
      {tasks.length > 0 ? (
        <ul className="space-y-2">
          {tasks.map((task, index) => (
            <li 
              key={task.id} 
              className="flex items-start gap-3 p-2 rounded-lg bg-muted/30 group cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleTaskClick(task)}
            >
              <Checkbox 
                checked={task.completed}
                onCheckedChange={(e) => {
                  e.valueOf(); // Prevent propagation
                  toggleComplete(task.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {index + 1}. {task.content}
                </span>
                <div className="flex gap-1 mt-1 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {getQuadrantBadge(task)}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleDeleteClick(e, task.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Нет задач. Добавьте первую задачу ниже.
        </p>
      )}

      {/* Add new task form - simplified without sliders */}
      <div className="space-y-3 pt-2 border-t border-border/50">
        <div className="flex gap-2">
          <Input
            placeholder="Текст задачи..."
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
            className="text-sm flex-1"
          />
          <Button 
            onClick={handleAddTask} 
            disabled={!newTaskText.trim() || isAdding}
            size="sm"
          >
            {isAdding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline"
                size="sm"
                onClick={() => setNewTaskModalOpen(true)}
              >
                <Expand className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Расширенное добавление задачи</p>
            </TooltipContent>
          </Tooltip>
        </div>
        
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Откройте задачу для AI-анализа приоритета. Задачи синхронизируются с Матрицей продуктивности.
        </p>
      </div>

      {/* Task edit modal - reusing from Productivity Matrix */}
      {selectedTask && (
        <TaskEditModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          task={getTaskForModal(selectedTask)}
          onSave={handleSaveTask}
          onDelete={handleDeleteFromModal}
        />
      )}

      {/* New task modal - for expanded creation */}
      <TaskEditModal
        open={newTaskModalOpen}
        onOpenChange={setNewTaskModalOpen}
        task={null}
        onSave={handleSaveNewTask}
        onDelete={() => setNewTaskModalOpen(false)}
        defaultCategoryId={sphereKey}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Задача будет удалена из сферы и Матрицы продуктивности.
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
