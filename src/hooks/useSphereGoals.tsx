import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export interface SphereGoal {
  id: string;
  sphere_key: string;
  content: string;
  completed: boolean;
  created_at: string;
}

export function useSphereGoals(sphereKey?: string) {
  const { user } = useAuth();
  const [goals, setGoals] = useState<SphereGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    if (!user) {
      setGoals([]);
      setLoading(false);
      return;
    }

    let query = supabase
      .from("sphere_goals")
      .select("id, sphere_key, content, completed, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (sphereKey) {
      query = query.eq("sphere_key", sphereKey);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching sphere goals:", error);
    } else {
      setGoals(data || []);
    }
    setLoading(false);
  }, [user, sphereKey]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const addGoal = async (content: string, sphereKey: string) => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("sphere_goals")
      .insert({ 
        user_id: user.id, 
        sphere_key: sphereKey,
        content 
      })
      .select("id, sphere_key, content, completed, created_at")
      .single();

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось добавить цель",
        variant: "destructive",
      });
      return null;
    }

    setGoals(prev => [...prev, data]);
    toast({
      title: "Цель добавлена",
      description: "Стратегическая цель успешно создана",
    });
    return data;
  };

  const updateGoal = async (goalId: string, updates: { 
    content?: string; 
    completed?: boolean 
  }) => {
    if (!user) return false;

    const { error } = await supabase
      .from("sphere_goals")
      .update(updates)
      .eq("id", goalId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось обновить цель",
        variant: "destructive",
      });
      return false;
    }

    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, ...updates } : g));
    return true;
  };

  const deleteGoal = async (goalId: string) => {
    if (!user) return false;

    const { error } = await supabase
      .from("sphere_goals")
      .delete()
      .eq("id", goalId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить цель",
        variant: "destructive",
      });
      return false;
    }

    setGoals(prev => prev.filter(g => g.id !== goalId));
    toast({
      title: "Успешно",
      description: "Цель удалена",
    });
    return true;
  };

  const toggleComplete = async (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return false;
    return updateGoal(goalId, { completed: !goal.completed });
  };

  return {
    goals,
    loading,
    addGoal,
    updateGoal,
    deleteGoal,
    toggleComplete,
    refetch: fetchGoals,
  };
}
