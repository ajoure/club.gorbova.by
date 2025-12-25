import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export interface EisenhowerTask {
  id: string;
  content: string;
  quadrant: string;
  source?: string;
  source_task_id?: string | null;
  completed: boolean;
  deadline_date: string | null;
  deadline_time: string | null;
  category_id: string | null;
  importance: number;
  urgency: number;
}

type QuadrantType = "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important" | "planned";

// Calculate quadrant from importance/urgency scores (1-10)
export function calculateQuadrant(importance: number, urgency: number): QuadrantType {
  if (importance >= 6 && urgency >= 6) return "urgent-important";
  if (importance >= 6 && urgency < 6) return "not-urgent-important";
  if (importance < 6 && urgency >= 6) return "urgent-not-important";
  return "not-urgent-not-important";
}

// Get default importance/urgency scores for a quadrant
function getScoresForQuadrant(quadrant: QuadrantType): { importance: number; urgency: number } {
  switch (quadrant) {
    case "urgent-important": return { importance: 8, urgency: 8 };
    case "not-urgent-important": return { importance: 8, urgency: 3 };
    case "urgent-not-important": return { importance: 3, urgency: 8 };
    case "not-urgent-not-important": return { importance: 3, urgency: 3 };
    case "planned": return { importance: 5, urgency: 5 };
  }
}

function getImportanceUrgency(quadrant: QuadrantType): { important: boolean; urgent: boolean } {
  switch (quadrant) {
    case "urgent-important": return { important: true, urgent: true };
    case "not-urgent-important": return { important: true, urgent: false };
    case "urgent-not-important": return { important: false, urgent: true };
    case "not-urgent-not-important": return { important: false, urgent: false };
    case "planned": return { important: false, urgent: false };
  }
}

export function useEisenhowerTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<EisenhowerTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    if (!user) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("eisenhower_tasks")
      .select("id, content, quadrant, source, source_task_id, completed, deadline_date, deadline_time, category_id, importance, urgency")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching tasks:", error);
    } else {
      setTasks(data || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const addTask = async (content: string, quadrant?: QuadrantType | null, options?: {
    completed?: boolean;
    deadline_date?: string | null;
    deadline_time?: string | null;
    category_id?: string | null;
    importance?: number;
    urgency?: number;
  }) => {
    if (!user) return null;

    // If no quadrant provided or null, use "planned" (planned tasks)
    const finalQuadrant: QuadrantType = quadrant || "planned";

    // Use provided importance/urgency or calculate defaults from quadrant
    const scores = options?.importance !== undefined && options?.urgency !== undefined
      ? { importance: options.importance, urgency: options.urgency }
      : getScoresForQuadrant(finalQuadrant);

    const { data, error } = await supabase
      .from("eisenhower_tasks")
      .insert({ 
        user_id: user.id, 
        content, 
        quadrant: finalQuadrant, 
        source: "direct",
        completed: options?.completed ?? false,
        deadline_date: options?.deadline_date ?? null,
        deadline_time: options?.deadline_time ?? null,
        category_id: options?.category_id ?? null,
        importance: scores.importance,
        urgency: scores.urgency,
      })
      .select("id, content, quadrant, source, source_task_id, completed, deadline_date, deadline_time, category_id, importance, urgency")
      .single();

    if (error) {
      console.error("Error adding task:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось добавить задачу",
        variant: "destructive",
      });
      return null;
    }

    setTasks(prev => [...prev, data]);
    return data;
  };

  const updateTask = async (taskId: string, updates: { 
    content?: string; 
    quadrant?: QuadrantType;
    completed?: boolean;
    deadline_date?: string | null;
    deadline_time?: string | null;
    category_id?: string | null;
    importance?: number;
    urgency?: number;
  }) => {
    if (!user) return false;

    const task = tasks.find(t => t.id === taskId);

    // If quadrant is being changed directly (e.g., from drag&drop), update importance/urgency
    let finalUpdates = { ...updates };
    if (updates.quadrant && updates.importance === undefined && updates.urgency === undefined) {
      const scores = getScoresForQuadrant(updates.quadrant);
      finalUpdates = { ...updates, ...scores };
    }
    
    // If importance/urgency is being changed, auto-recalculate quadrant
    if ((updates.importance !== undefined || updates.urgency !== undefined) && updates.quadrant === undefined) {
      const newImportance = updates.importance ?? task?.importance ?? 5;
      const newUrgency = updates.urgency ?? task?.urgency ?? 5;
      finalUpdates.quadrant = calculateQuadrant(newImportance, newUrgency);
    }

    const { error } = await supabase
      .from("eisenhower_tasks")
      .update(finalUpdates)
      .eq("id", taskId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось обновить задачу",
        variant: "destructive",
      });
      return false;
    }

    // Sync with wheel task if linked
    if (finalUpdates.quadrant && task?.source === "wheel_balance" && task?.source_task_id) {
      const { important, urgent } = getImportanceUrgency(finalUpdates.quadrant);
      const importanceScore = finalUpdates.importance ?? task?.importance ?? 5;
      const urgencyScore = finalUpdates.urgency ?? task?.urgency ?? 5;
      await supabase
        .from("wheel_balance_tasks")
        .update({ 
          important, 
          urgent,
          importance_score: importanceScore,
          urgency_score: urgencyScore
        })
        .eq("id", task.source_task_id);
    }

    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...finalUpdates } : t));
    return true;
  };

  const deleteTask = async (taskId: string) => {
    if (!user) return false;

    const { error } = await supabase
      .from("eisenhower_tasks")
      .delete()
      .eq("id", taskId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить задачу",
        variant: "destructive",
      });
      return false;
    }

    setTasks(prev => prev.filter(t => t.id !== taskId));
    return true;
  };

  const moveTask = async (taskId: string, newQuadrant: QuadrantType) => {
    return updateTask(taskId, { quadrant: newQuadrant });
  };

  const toggleCompleted = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;
    return updateTask(taskId, { completed: !task.completed });
  };

  const clearCompleted = async () => {
    if (!user) return false;

    const completedTasks = tasks.filter(t => t.completed);
    if (completedTasks.length === 0) return true;

    const { error } = await supabase
      .from("eisenhower_tasks")
      .delete()
      .eq("user_id", user.id)
      .eq("completed", true);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить выполненные задачи",
        variant: "destructive",
      });
      return false;
    }

    setTasks(prev => prev.filter(t => !t.completed));
    toast({
      title: "Успешно",
      description: `Удалено ${completedTasks.length} задач`,
    });
    return true;
  };

  return {
    tasks,
    loading,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    toggleCompleted,
    clearCompleted,
    refetch: fetchTasks,
  };
}
