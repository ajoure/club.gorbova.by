import { useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { LayoutGrid, Plus, X, GripVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
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

interface Quadrant {
  title: string;
  subtitle: string;
  color: string;
  bgColor: string;
  dbKey: string;
}

const quadrantConfig: Record<string, Quadrant> = {
  urgent_important: {
    title: "Срочно и Важно",
    subtitle: "Делать немедленно",
    color: "hsl(350 89% 60%)",
    bgColor: "hsl(350 89% 60% / 0.1)",
    dbKey: "urgent-important",
  },
  not_urgent_important: {
    title: "Важно, не Срочно",
    subtitle: "Запланировать",
    color: "hsl(217 91% 60%)",
    bgColor: "hsl(217 91% 60% / 0.1)",
    dbKey: "not-urgent-important",
  },
  urgent_not_important: {
    title: "Срочно, не Важно",
    subtitle: "Делегировать",
    color: "hsl(38 92% 50%)",
    bgColor: "hsl(38 92% 50% / 0.1)",
    dbKey: "urgent-not-important",
  },
  not_urgent_not_important: {
    title: "Не Срочно, не Важно",
    subtitle: "Исключить",
    color: "hsl(220 9% 46%)",
    bgColor: "hsl(220 9% 46% / 0.1)",
    dbKey: "not-urgent-not-important",
  },
};

function SortableTask({ 
  task, 
  quadrantColor, 
  onRemove 
}: { 
  task: EisenhowerTask; 
  quadrantColor: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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
      <div 
        className="w-2 h-2 rounded-full shrink-0" 
        style={{ backgroundColor: quadrantColor }}
      />
      <span className="flex-1 text-sm text-foreground">{task.content}</span>
      <button 
        onClick={onRemove} 
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
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
  const { tasks, loading, addTask, deleteTask, moveTask } = useEisenhowerTasks();
  const [newTask, setNewTask] = useState<Record<string, string>>({});
  const [activeTask, setActiveTask] = useState<EisenhowerTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleAddTask = async (quadrantKey: string) => {
    if (!newTask[quadrantKey]?.trim()) return;
    
    const dbKey = quadrantConfig[quadrantKey].dbKey as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important";
    await addTask(newTask[quadrantKey].trim(), dbKey);
    setNewTask(prev => ({ ...prev, [quadrantKey]: "" }));
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
      const newQuadrant = quadrantConfig[overIdStr].dbKey as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important";
      await moveTask(activeTaskId, newQuadrant);
      return;
    }

    // Dropped on another task
    const overTask = tasks.find(t => t.id === overIdStr);
    if (overTask && overTask.quadrant) {
      await moveTask(activeTaskId, overTask.quadrant as "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important");
    }
  };

  const getQuadrantTasks = (quadrantKey: string) => 
    tasks.filter(t => t.quadrant === quadrantConfig[quadrantKey].dbKey);

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
                const quadrantTasks = getQuadrantTasks(key);
                
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
                        <div>
                          <h3 className="font-semibold text-foreground">{quadrant.title}</h3>
                          <p className="text-xs text-muted-foreground">{quadrant.subtitle}</p>
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
                            onRemove={() => deleteTask(task.id)}
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
    </DashboardLayout>
  );
}
