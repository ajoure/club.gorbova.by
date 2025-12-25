import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export interface EisenhowerTask {
  id: string;
  content: string;
  quadrant: string;
}

type QuadrantType = "urgent-important" | "not-urgent-important" | "urgent-not-important" | "not-urgent-not-important";

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
      .select("id, content, quadrant")
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

  const addTask = async (content: string, quadrant: QuadrantType) => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("eisenhower_tasks")
      .insert({ user_id: user.id, content, quadrant })
      .select("id, content, quadrant")
      .single();

    if (error) {
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

  const updateTask = async (taskId: string, updates: { content?: string; quadrant?: QuadrantType }) => {
    if (!user) return false;

    const { error } = await supabase
      .from("eisenhower_tasks")
      .update(updates)
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

    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
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

  return {
    tasks,
    loading,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    refetch: fetchTasks,
  };
}
