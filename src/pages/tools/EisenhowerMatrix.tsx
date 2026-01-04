import { useState, forwardRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { LayoutGrid, Plus, X, Loader2, Trash2, Info, ClipboardList, Expand, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatrixAnalysisModal } from "@/components/eisenhower/MatrixAnalysisModal";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEisenhowerTasks, EisenhowerTask } from "@/hooks/useEisenhowerTasks";
import { TaskEditModal } from "@/components/eisenhower/TaskEditModal";
import { ClearCompletedDialog } from "@/components/eisenhower/ClearCompletedDialog";
import { DeleteTaskDialog } from "@/components/eisenhower/DeleteTaskDialog";
import { format, parse, isBefore, startOfDay } from "date-fns";
import { SPHERES, getGroupedSpheres, getSphereById } from "@/constants/spheres";
import { HelpIcon } from "@/components/help/HelpComponents";

interface Quadrant {
  title: string;
  subtitle: string;
  color: string;
  bgColor: string;
  dbKey: string;
  tooltip: string;
}

const quadrantConfig: Record<string, Quadrant> = {
  urgent_important: {
    title: "Срочно и Важно",
    subtitle: "Делать немедленно",
    color: "hsl(350 89% 60%)",
    bgColor: "hsl(350 89% 60% / 0.1)",
    dbKey: "urgent-important",
    tooltip: "Задачи, требующие немедленного внимания. Делать сейчас.",
  },
  not_urgent_important: {
    title: "Важно, не Срочно",
    subtitle: "Запланировать",
    color: "hsl(217 91% 60%)",
    bgColor: "hsl(217 91% 60% / 0.1)",
    dbKey: "not-urgent-important",
    tooltip: "Задачи развития и ключевых целей. Планировать.",
  },
  urgent_not_important: {
    title: "Срочно, не Важно",
    subtitle: "Делегировать",
    color: "hsl(38 92% 50%)",
    bgColor: "hsl(38 92% 50% / 0.1)",
    dbKey: "urgent-not-important",
    tooltip: "Суета и чужие приоритеты. Делегировать/ограничивать.",
  },
  not_urgent_not_important: {
    title: "Не Срочно, не Важно",
    subtitle: "Исключить",
    color: "hsl(220 9% 46%)",
    bgColor: "hsl(220 9% 46% / 0.1)",
    dbKey: "not-urgent-not-important",
    tooltip: "Отвлекающее и не дающее ценности. Исключить.",
  },
};

type StatusFilter = "all" | "active" | "completed" | "planned";

function isOverdue(task: EisenhowerTask): boolean {
  if (!task.deadline_date || task.completed) return false;
  const deadline = parse(task.deadline_date, "yyyy-MM-dd", new Date());
  if (task.deadline_time) {
    const [hours, minutes] = task.deadline_time.split(":").map(Number);
    deadline.setHours(hours, minutes);
    return isBefore(deadline, new Date());
  }
  return isBefore(startOfDay(deadline), startOfDay(new Date()));
}

function formatDeadline(task: EisenhowerTask): string {
  if (!task.deadline_date) return "";
  const date = parse(task.deadline_date, "yyyy-MM-dd", new Date());
  const formatted = format(date, "dd.MM");
  return task.deadline_time ? `${formatted} ${task.deadline_time}` : formatted;
}

// Draggable task card - entire card is draggable (no 6-dot handle)
const SortableTask = forwardRef<HTMLDivElement, { 
  task: EisenhowerTask; 
  quadrantColor: string;
  categoryColor?: string;
  onRemove: () => void;
  onToggleCompleted: () => void;
  onClick: () => void;
  isDragDisabled?: boolean;
}>(function SortableTask({ 
  task, 
  quadrantColor, 
  categoryColor,
  onRemove,
  onToggleCompleted,
  onClick,
  isDragDisabled = false,
}, ref) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: task.id,
    disabled: isDragDisabled,
  });

  const overdue = isOverdue(task);
  const deadline = formatDeadline(task);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : task.completed ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isDragDisabled ? {} : listeners)}
      className={`flex items-center gap-2 p-3 rounded-xl bg-background/80 border border-border/50 group hover:border-primary/30 hover:bg-background/90 hover:shadow-md transition-all touch-none ${
        isDragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <div 
        onClick={(e) => {
          e.stopPropagation();
          onToggleCompleted();
        }}
        className="cursor-pointer"
      >
        <Checkbox
          checked={task.completed}
          className="shrink-0 pointer-events-none"
        />
      </div>
      
      {categoryColor && (
        <div 
          className="w-2 h-2 rounded-full shrink-0" 
          style={{ backgroundColor: categoryColor }}
        />
      )}
      
      <div 
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex-1 min-w-0 cursor-pointer"
      >
        <span className={`text-sm text-foreground block truncate ${task.completed ? "line-through" : ""}`}>
          {task.content}
        </span>
        {deadline && (
          <span className={`text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
            {overdue ? "Просрочено: " : ""}{deadline}
          </span>
        )}
      </div>
      
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }} 
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

function TaskOverlay({ task, quadrantColor }: { task: EisenhowerTask; quadrantColor: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-card border border-primary shadow-xl cursor-grabbing">
      <div 
        className="w-2 h-2 rounded-full shrink-0" 
        style={{ backgroundColor: quadrantColor }}
      />
      <span className="flex-1 text-sm text-foreground">{task.content}</span>
    </div>
  );
}

// Droppable area for planned tasks
function DroppablePlanned({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "planned" });
  
  return (
    <div 
      ref={setNodeRef}
      className={`space-y-2 min-h-[60px] rounded-lg transition-colors ${isOver ? "bg-primary/10" : ""}`}
    >
      {children}
    </div>
  );
}

// Droppable quadrant - using useDroppable hook
function DroppableQuadrant({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  
  return (
    <div 
      ref={setNodeRef}
      className={`space-y-2 min-h-[180px] rounded-lg transition-colors ${isOver ? "bg-primary/10" : ""}`}
    >
      {children}
    </div>
  );
}

export default function EisenhowerMatrix() {
  const { tasks, loading, addTask, updateTask, deleteTask, moveTask, toggleCompleted, clearCompleted } = useEisenhowerTasks();
  
  const [plannedTaskInput, setPlannedTaskInput] = useState("");
  const [activeTask, setActiveTask] = useState<EisenhowerTask | null>(null);
  const [editingTask, setEditingTask] = useState<EisenhowerTask | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sphereFilter, setSphereFilter] = useState<string | null>(null);
  const [isNewTask, setIsNewTask] = useState(false);
  
  const groupedSpheres = getGroupedSpheres();
  
  // Delete confirmation state
  const [taskToDelete, setTaskToDelete] = useState<EisenhowerTask | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  
  // Analysis modal state
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Quick add task to planned (inbox) - no quadrant assigned
  const handleAddPlannedTask = async () => {
    if (!plannedTaskInput.trim()) return;
    await addTask(plannedTaskInput.trim(), null); // null = inbox/planned
    setPlannedTaskInput("");
  };

  const handleOpenNewTaskModal = () => {
    setIsNewTask(true);
    setEditingTask(null);
    setShowEditModal(true);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id);
    // Don't allow dragging completed tasks
    if (task?.completed) {
      return;
    }
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const activeTaskData = tasks.find(t => t.id === activeTaskId);
    
    // Don't allow moving completed tasks
    if (activeTaskData?.completed) return;

    const overIdStr = over.id as string;

    // Check if dropped on planned area
    if (overIdStr === "planned") {
      await moveTask(activeTaskId, "planned");
      return;
    }

    // Check if dropped on a quadrant container
    if (Object.keys(quadrantConfig).includes(overIdStr)) {
      const newQuadrant = quadrantConfig[overIdStr].dbKey as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "planned";
      await moveTask(activeTaskId, newQuadrant);
      return;
    }

    // Dropped on another task - move to same quadrant
    const overTask = tasks.find(t => t.id === overIdStr);
    if (overTask) {
      const targetQuadrant = overTask.quadrant as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "planned";
      await moveTask(activeTaskId, targetQuadrant);
    }
  };

  const getFilteredTasks = (quadrantKey: string) => {
    const isPlanned = quadrantKey === "planned";
    let filtered = isPlanned 
      ? tasks.filter(t => t.quadrant === "planned")
      : tasks.filter(t => t.quadrant === quadrantConfig[quadrantKey].dbKey);
    
    if (statusFilter === "active") {
      filtered = filtered.filter(t => !t.completed);
    } else if (statusFilter === "completed") {
      filtered = filtered.filter(t => t.completed);
    }
    
    if (sphereFilter) {
      filtered = filtered.filter(t => t.category_id === sphereFilter);
    }
    
    return filtered;
  };

  const plannedTasks = tasks.filter(t => t.quadrant === "planned");

  const completedCount = tasks.filter(t => t.completed).length;

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
    // Convert null quadrant to "planned"
    const finalQuadrant = updates.quadrant || "planned";
    
    if (isNewTask) {
      await addTask(updates.content, finalQuadrant as any, {
        completed: updates.completed,
        deadline_date: updates.deadline_date,
        deadline_time: updates.deadline_time,
        category_id: updates.category_id,
        importance: updates.importance,
        urgency: updates.urgency,
      });
      setIsNewTask(false);
    } else if (editingTask) {
      await updateTask(editingTask.id, {
        ...updates,
        quadrant: finalQuadrant as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "planned",
      });
    }
    setEditingTask(null);
  };

  const handleDeleteFromModal = async () => {
    if (editingTask) {
      await deleteTask(editingTask.id);
      setShowEditModal(false);
      setEditingTask(null);
    }
    setIsNewTask(false);
  };

  const handleDeleteTask = (task: EisenhowerTask) => {
    setTaskToDelete(task);
    setShowDeleteDialog(true);
  };

  const confirmDeleteTask = async () => {
    if (taskToDelete) {
      await deleteTask(taskToDelete.id);
      setTaskToDelete(null);
      setShowDeleteDialog(false);
    }
  };

  const getSphereColor = (sphereId: string | null) => {
    if (!sphereId) return undefined;
    return getSphereById(sphereId).color;
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <TooltipProvider>
      <DashboardLayout>
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <LayoutGrid className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Матрица продуктивности</h1>
              <p className="text-muted-foreground">Перетаскивайте задачи между секторами для приоритизации</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
              <Button 
                variant={statusFilter === "all" ? "default" : "ghost"} 
                size="sm"
                onClick={() => setStatusFilter("all")}
              >
                Все
              </Button>
              <Button 
                variant={statusFilter === "planned" ? "default" : "ghost"} 
                size="sm"
                onClick={() => setStatusFilter("planned")}
                className="gap-1"
              >
                <ClipboardList className="w-4 h-4" />
                Планируемые
                {plannedTasks.length > 0 && (
                  <span className="ml-1 bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">
                    {plannedTasks.length}
                  </span>
                )}
              </Button>
              <Button 
                variant={statusFilter === "active" ? "default" : "ghost"} 
                size="sm"
                onClick={() => setStatusFilter("active")}
              >
                Активные
              </Button>
              <Button 
                variant={statusFilter === "completed" ? "default" : "ghost"} 
                size="sm"
                onClick={() => setStatusFilter("completed")}
              >
                Выполненные
              </Button>
            </div>

            <Select value={sphereFilter || "all"} onValueChange={(v) => setSphereFilter(v === "all" ? null : v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Все сферы" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="all">Все сферы</SelectItem>
                {groupedSpheres.map((group) => (
                  <SelectGroup key={group.group}>
                    <SelectLabel className="text-xs text-muted-foreground">{group.group}</SelectLabel>
                    {group.spheres.map((sphere) => (
                      <SelectItem key={sphere.id} value={sphere.id}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: sphere.color }}
                          />
                          {sphere.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2 ml-auto">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowAnalysisModal(true)}
                className="gap-1"
              >
                <BarChart3 className="w-4 h-4" />
                Анализ матрицы
              </Button>
              {completedCount > 0 && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowClearDialog(true)}
                  className="gap-1"
                >
                  <Trash2 className="w-4 h-4" />
                  Очистить выполненные ({completedCount})
                </Button>
              )}
            </div>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* Planned Tasks Section - always visible */}
            <GlassCard className="border-primary/30">
              <div className="flex items-center gap-3 mb-4">
                <ClipboardList className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">Планируемые задачи</h3>
                  <p className="text-xs text-muted-foreground">Единая точка входа для создания задач. Распределите по квадрантам</p>
                </div>
                <span className="ml-auto text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary">
                  {getFilteredTasks("planned").length}
                </span>
              </div>

              <SortableContext
                id="planned"
                items={getFilteredTasks("planned").map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppablePlanned>
                  {getFilteredTasks("planned").map(task => (
                    <SortableTask
                      key={task.id}
                      task={task}
                      quadrantColor="hsl(217 91% 60%)"
                      categoryColor={getSphereColor(task.category_id)}
                      onRemove={() => handleDeleteTask(task)}
                      onToggleCompleted={() => toggleCompleted(task.id)}
                      onClick={() => {
                        setEditingTask(task);
                        setIsNewTask(false);
                        setShowEditModal(true);
                      }}
                      isDragDisabled={task.completed}
                    />
                  ))}
                  {getFilteredTasks("planned").length === 0 && (
                    <div className="h-[60px] flex items-center justify-center rounded-xl border-2 border-dashed border-border/50 text-sm text-muted-foreground">
                      Нет планируемых задач
                    </div>
                  )}
                </DroppablePlanned>
              </SortableContext>

              <div className="flex gap-2 mt-4">
                <Input
                  placeholder="Название новой задачи..."
                  value={plannedTaskInput}
                  onChange={(e) => setPlannedTaskInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPlannedTask()}
                  className="h-9 text-sm bg-background/50"
                />
                <Button size="sm" onClick={handleAddPlannedTask} className="shrink-0">
                  <Plus className="w-4 h-4" />
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" onClick={handleOpenNewTaskModal} className="shrink-0">
                      <Expand className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Расширенное создание с AI-приоритетом</TooltipContent>
                </Tooltip>
              </div>
            </GlassCard>

            {/* Axis labels */}
            <div className="relative">
              <div className="absolute -left-6 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-medium text-muted-foreground whitespace-nowrap hidden lg:block">
                ВАЖНОСТЬ →
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 -top-6 text-xs font-medium text-muted-foreground hidden lg:block">
                СРОЧНОСТЬ →
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(quadrantConfig).map(([key, quadrant]) => {
                  const quadrantTasks = getFilteredTasks(key);
                  
                  return (
                    <SortableContext
                      key={key}
                      id={key}
                      items={quadrantTasks.map(t => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <GlassCard 
                        className="min-h-[280px]"
                        style={{ 
                          borderColor: `${quadrant.color}30`,
                          background: `linear-gradient(135deg, ${quadrant.bgColor}, hsl(var(--card) / 0.7))`,
                        }}
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: quadrant.color }}
                          />
                          <div className="flex items-center gap-1">
                            <h3 className="font-semibold text-foreground">{quadrant.title}</h3>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="text-muted-foreground hover:text-foreground">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">{quadrant.tooltip}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <span 
                            className="ml-auto text-xs font-medium px-2 py-1 rounded-full"
                            style={{ 
                              backgroundColor: quadrant.bgColor,
                              color: quadrant.color 
                            }}
                          >
                            {quadrantTasks.length}
                          </span>
                        </div>

                        {/* No input fields in quadrants - only display and drag */}
                        <DroppableQuadrant id={key}>
                          {quadrantTasks.map(task => (
                            <SortableTask
                              key={task.id}
                              task={task}
                              quadrantColor={quadrant.color}
                              categoryColor={getSphereColor(task.category_id)}
                              onRemove={() => handleDeleteTask(task)}
                              onToggleCompleted={() => toggleCompleted(task.id)}
                              onClick={() => {
                                setEditingTask(task);
                                setIsNewTask(false);
                                setShowEditModal(true);
                              }}
                              isDragDisabled={task.completed}
                            />
                          ))}
                          {quadrantTasks.length === 0 && (
                            <div className="h-[60px] flex items-center justify-center rounded-xl border-2 border-dashed border-border/50 text-sm text-muted-foreground">
                              Перетащите задачу сюда
                            </div>
                          )}
                        </DroppableQuadrant>
                      </GlassCard>
                    </SortableContext>
                  );
                })}
              </div>

              <DragOverlay>
                {activeTask && (
                  <TaskOverlay 
                    task={activeTask} 
                    quadrantColor={Object.values(quadrantConfig).find(q => q.dbKey === activeTask.quadrant)?.color || "hsl(217 91% 60%)"} 
                  />
                )}
              </DragOverlay>
            </div>
          </DndContext>

          {/* Legend */}
          <GlassCard className="mt-6">
            <h4 className="font-semibold text-foreground mb-3">Как использовать матрицу</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              {Object.entries(quadrantConfig).map(([key, q]) => (
                <div key={key} className="flex items-start gap-2">
                  <div 
                    className="w-3 h-3 rounded-full mt-1 shrink-0" 
                    style={{ backgroundColor: q.color }}
                  />
                  <div>
                    <p className="font-medium text-foreground">{q.title}</p>
                    <p className="text-muted-foreground">{q.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        <TaskEditModal
          open={showEditModal}
          onOpenChange={(open) => {
            setShowEditModal(open);
            if (!open) {
              setIsNewTask(false);
              setEditingTask(null);
            }
          }}
          task={editingTask}
          onSave={handleSaveTask}
          onDelete={handleDeleteFromModal}
          isNew={isNewTask}
        />


        <ClearCompletedDialog
          open={showClearDialog}
          onOpenChange={setShowClearDialog}
          count={completedCount}
          onConfirm={() => {
            clearCompleted();
            setShowClearDialog(false);
          }}
        />

        <DeleteTaskDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          taskName={taskToDelete?.content || ""}
          onConfirm={confirmDeleteTask}
        />

        <MatrixAnalysisModal
          open={showAnalysisModal}
          onOpenChange={setShowAnalysisModal}
          tasks={tasks}
        />
      </DashboardLayout>
    </TooltipProvider>
  );
}
