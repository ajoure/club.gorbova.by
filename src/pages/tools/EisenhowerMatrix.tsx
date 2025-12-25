import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { LayoutGrid, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Task {
  id: string;
  text: string;
}

interface Quadrant {
  title: string;
  subtitle: string;
  color: string;
  tasks: Task[];
}

const initialQuadrants: Record<string, Quadrant> = {
  urgent_important: {
    title: "Срочно и Важно",
    subtitle: "Делать немедленно",
    color: "from-red-500 to-rose-500",
    tasks: [],
  },
  not_urgent_important: {
    title: "Важно, не Срочно",
    subtitle: "Запланировать",
    color: "from-blue-500 to-cyan-500",
    tasks: [],
  },
  urgent_not_important: {
    title: "Срочно, не Важно",
    subtitle: "Делегировать",
    color: "from-amber-500 to-orange-500",
    tasks: [],
  },
  not_urgent_not_important: {
    title: "Не Срочно, не Важно",
    subtitle: "Исключить",
    color: "from-gray-400 to-gray-500",
    tasks: [],
  },
};

export default function EisenhowerMatrix() {
  const [quadrants, setQuadrants] = useState(initialQuadrants);
  const [newTask, setNewTask] = useState<Record<string, string>>({});

  const addTask = (quadrantKey: string) => {
    if (!newTask[quadrantKey]?.trim()) return;
    
    setQuadrants(prev => ({
      ...prev,
      [quadrantKey]: {
        ...prev[quadrantKey],
        tasks: [...prev[quadrantKey].tasks, { id: Date.now().toString(), text: newTask[quadrantKey] }],
      },
    }));
    setNewTask(prev => ({ ...prev, [quadrantKey]: "" }));
  };

  const removeTask = (quadrantKey: string, taskId: string) => {
    setQuadrants(prev => ({
      ...prev,
      [quadrantKey]: {
        ...prev[quadrantKey],
        tasks: prev[quadrantKey].tasks.filter(t => t.id !== taskId),
      },
    }));
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <LayoutGrid className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Матрица Эйзенхауэра</h1>
            <p className="text-muted-foreground">Приоритизация задач по важности и срочности</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(quadrants).map(([key, quadrant]) => (
            <GlassCard key={key} className="min-h-[280px]">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${quadrant.color}`} />
                <div>
                  <h3 className="font-semibold text-foreground">{quadrant.title}</h3>
                  <p className="text-xs text-muted-foreground">{quadrant.subtitle}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {quadrant.tasks.map(task => (
                  <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <span className="flex-1 text-sm text-foreground">{task.text}</span>
                    <button onClick={() => removeTask(key, task.id)} className="text-muted-foreground hover:text-destructive">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Новая задача..."
                  value={newTask[key] || ""}
                  onChange={(e) => setNewTask(prev => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addTask(key)}
                  className="h-9 text-sm"
                />
                <Button size="sm" onClick={() => addTask(key)} className="shrink-0">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
