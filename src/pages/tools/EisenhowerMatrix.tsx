import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { LayoutGrid, Plus, X, GripVertical, Loader2, Settings, Trash2, Info, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEisenhowerTasks, EisenhowerTask } from "@/hooks/useEisenhowerTasks";
import { useTaskCategories } from "@/hooks/useTaskCategories";
import { TaskEditModal } from "@/components/eisenhower/TaskEditModal";
import { CategoryManager } from "@/components/eisenhower/CategoryManager";
import { ClearCompletedDialog } from "@/components/eisenhower/ClearCompletedDialog";
import { format, parse, isBefore, startOfDay } from "date-fns";

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

type StatusFilter = "all" | "active" | "completed" | "inbox";

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

function SortableTask({ 
  task, 
  quadrantColor, 
  categoryColor,
  onRemove,
  onToggleCompleted,
  onClick,
}: { 
  task: EisenhowerTask; 
  quadrantColor: string;
  categoryColor?: string;
  onRemove: () => void;
  onToggleCompleted: () => void;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

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
      className="flex items-center gap-2 p-3 rounded-xl bg-background/80 border border-border/50 group hover:border-primary/30 transition-all"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      
      <Checkbox
        checked={task.completed}
        onCheckedChange={onToggleCompleted}
        className="shrink-0"
      />
      
      {categoryColor && (
        <div 
          className="w-2 h-2 rounded-full shrink-0" 
          style={{ backgroundColor: categoryColor }}
        />
      )}
      
      <button 
        onClick={onClick}
        className="flex-1 text-left min-w-0"
      >
        <span className={`text-sm text-foreground block truncate ${task.completed ? "line-through" : ""}`}>
          {task.content}
        </span>
        {deadline && (
          <span className={`text-xs ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
            {overdue ? "Просрочено: " : ""}{deadline}
          </span>
        )}
      </button>
      
      <button 
        onClick={onRemove} 
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function TaskOverlay({ task, quadrantColor }: { task: EisenhowerTask; quadrantColor: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-card border border-primary shadow-xl">
      <GripVertical className="w-4 h-4 text-muted-foreground" />
      <div 
        className="w-2 h-2 rounded-full shrink-0" 
        style={{ backgroundColor: quadrantColor }}
      />
      <span className="flex-1 text-sm text-foreground">{task.content}</span>
    </div>
  );
}

export default function EisenhowerMatrix() {
  const { tasks, loading, addTask, updateTask, deleteTask, moveTask, toggleCompleted, clearCompleted } = useEisenhowerTasks();
  const { categories, canManageCategories, addCategory, deleteCategory } = useTaskCategories();
  
  const [newTask, setNewTask] = useState<Record<string, string>>({});
  const [activeTask, setActiveTask] = useState<EisenhowerTask | null>(null);
  const [editingTask, setEditingTask] = useState<EisenhowerTask | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleAddTask = async (quadrantKey: string) => {
    if (!newTask[quadrantKey]?.trim()) return;
    
    const dbKey = quadrantKey === "inbox" 
      ? "inbox" 
      : quadrantConfig[quadrantKey].dbKey as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important";
    await addTask(newTask[quadrantKey].trim(), dbKey as any);
    setNewTask(prev => ({ ...prev, [quadrantKey]: "" }));
  };

  const handleAddInboxTask = async () => {
    if (!newTask["inbox"]?.trim()) return;
    await addTask(newTask["inbox"].trim(), "inbox" as any);
    setNewTask(prev => ({ ...prev, inbox: "" }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const overIdStr = over.id as string;

    // Check if dropped on a quadrant container
    if (Object.keys(quadrantConfig).includes(overIdStr)) {
      const newQuadrant = quadrantConfig[overIdStr].dbKey as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "inbox";
      await moveTask(activeTaskId, newQuadrant);
      return;
    }

    // Dropped on another task
    const overTask = tasks.find(t => t.id === overIdStr);
    if (overTask && overTask.quadrant) {
      await moveTask(activeTaskId, overTask.quadrant as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "inbox");
    }
  };

  const getFilteredTasks = (quadrantKey: string) => {
    const isInbox = quadrantKey === "inbox";
    let filtered = isInbox 
      ? tasks.filter(t => t.quadrant === "inbox")
      : tasks.filter(t => t.quadrant === quadrantConfig[quadrantKey].dbKey);
    
    if (statusFilter === "active") {
      filtered = filtered.filter(t => !t.completed);
    } else if (statusFilter === "completed") {
      filtered = filtered.filter(t => t.completed);
    }
    
    if (categoryFilter) {
      filtered = filtered.filter(t => t.category_id === categoryFilter);
    }
    
    return filtered;
  };

  const inboxTasks = tasks.filter(t => t.quadrant === "inbox");
  const showInbox = statusFilter === "inbox" || inboxTasks.length > 0;

  const completedCount = tasks.filter(t => t.completed).length;

  const handleSaveTask = async (updates: {
    content: string;
    quadrant: string;
    completed: boolean;
    deadline_date: string | null;
    deadline_time: string | null;
    category_id: string | null;
  }) => {
    if (editingTask) {
      await updateTask(editingTask.id, {
        ...updates,
        quadrant: updates.quadrant as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "inbox",
      });
    }
    setEditingTask(null);
  };

  const handleDeleteTask = async () => {
    if (editingTask) {
      await deleteTask(editingTask.id);
      setShowEditModal(false);
      setEditingTask(null);
    }
  };

  const getCategoryColor = (categoryId: string | null) => {
    if (!categoryId) return undefined;
    return categories.find(c => c.id === categoryId)?.color;
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
              <h1 className="text-3xl font-bold text-foreground">Матрица Эйзенхауэра</h1>
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
                variant={statusFilter === "inbox" ? "default" : "ghost"} 
                size="sm"
                onClick={() => setStatusFilter("inbox")}
                className="gap-1"
              >
                <Inbox className="w-4 h-4" />
                Входящие
                {inboxTasks.length > 0 && (
                  <span className="ml-1 bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">
                    {inboxTasks.length}
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

            <div className="flex gap-1 flex-wrap">
              <Button 
                variant={categoryFilter === null ? "secondary" : "ghost"} 
                size="sm"
                onClick={() => setCategoryFilter(null)}
              >
                Все сферы
              </Button>
              {categories.map(cat => (
                <Button 
                  key={cat.id}
                  variant={categoryFilter === cat.id ? "secondary" : "ghost"} 
                  size="sm"
                  onClick={() => setCategoryFilter(cat.id)}
                  className="gap-1"
                >
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: cat.color }}
                  />
                  {cat.name}
                </Button>
              ))}
            </div>

            <div className="flex gap-2 ml-auto">
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
              {canManageCategories && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowCategoryManager(true)}
                  className="gap-1"
                >
                  <Settings className="w-4 h-4" />
                  Сферы
                </Button>
              )}
            </div>
          </div>

          {/* Inbox Section */}
          {(statusFilter === "inbox" || (statusFilter === "all" && inboxTasks.length > 0)) && (
            <GlassCard className="border-primary/30">
              <div className="flex items-center gap-3 mb-4">
                <Inbox className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">Входящие</h3>
                  <p className="text-xs text-muted-foreground">Задачи для распределения по квадрантам</p>
                </div>
                <span className="ml-auto text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary">
                  {getFilteredTasks("inbox").length}
                </span>
              </div>

              <div className="space-y-2 mb-4 min-h-[60px]">
                {getFilteredTasks("inbox").map(task => (
                  <SortableTask
                    key={task.id}
                    task={task}
                    quadrantColor="hsl(217 91% 60%)"
                    categoryColor={getCategoryColor(task.category_id)}
                    onRemove={() => deleteTask(task.id)}
                    onToggleCompleted={() => toggleCompleted(task.id)}
                    onClick={() => {
                      setEditingTask(task);
                      setShowEditModal(true);
                    }}
                  />
                ))}
                {getFilteredTasks("inbox").length === 0 && statusFilter === "inbox" && (
                  <div className="h-[60px] flex items-center justify-center rounded-xl border-2 border-dashed border-border/50 text-sm text-muted-foreground">
                    Нет входящих задач
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Новая задача во входящие..."
                  value={newTask["inbox"] || ""}
                  onChange={(e) => setNewTask(prev => ({ ...prev, inbox: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && handleAddInboxTask()}
                  className="h-9 text-sm bg-background/50"
                />
                <Button size="sm" onClick={handleAddInboxTask} className="shrink-0">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </GlassCard>
          )}

          {/* Axis labels */}
          <div className="relative">
            <div className="absolute -left-6 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-medium text-muted-foreground whitespace-nowrap hidden lg:block">
              ВАЖНОСТЬ →
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 -top-6 text-xs font-medium text-muted-foreground hidden lg:block">
              СРОЧНОСТЬ →
            </div>
            
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
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

                        <div className="space-y-2 mb-4 min-h-[100px]" data-droppable={key}>
                          {quadrantTasks.map(task => (
                            <SortableTask
                              key={task.id}
                              task={task}
                              quadrantColor={quadrant.color}
                              categoryColor={getCategoryColor(task.category_id)}
                              onRemove={() => deleteTask(task.id)}
                              onToggleCompleted={() => toggleCompleted(task.id)}
                              onClick={() => {
                                setEditingTask(task);
                                setShowEditModal(true);
                              }}
                            />
                          ))}
                          {quadrantTasks.length === 0 && (
                            <div className="h-[60px] flex items-center justify-center rounded-xl border-2 border-dashed border-border/50 text-sm text-muted-foreground">
                              Перетащите задачу сюда
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <Input
                            placeholder="Новая задача..."
                            value={newTask[key] || ""}
                            onChange={(e) => setNewTask(prev => ({ ...prev, [key]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && handleAddTask(key)}
                            className="h-9 text-sm bg-background/50"
                          />
                          <Button size="sm" onClick={() => handleAddTask(key)} className="shrink-0">
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
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
            </DndContext>
          </div>

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
          onOpenChange={setShowEditModal}
          task={editingTask}
          categories={categories}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
        />

        <CategoryManager
          open={showCategoryManager}
          onOpenChange={setShowCategoryManager}
          categories={categories}
          onAdd={addCategory}
          onDelete={deleteCategory}
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
      </DashboardLayout>
    </TooltipProvider>
  );
}
