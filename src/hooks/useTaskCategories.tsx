import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export interface TaskCategory {
  id: string;
  name: string;
  color: string;
}

export function useTaskCategories() {
  const { user, role } = useAuth();
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCategories = useCallback(async () => {
    if (!user) {
      setCategories([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("task_categories")
      .select("id, name, color")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching categories:", error);
    } else {
      setCategories(data || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const addCategory = async (name: string, color: string) => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("task_categories")
      .insert({ user_id: user.id, name, color })
      .select("id, name, color")
      .single();

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось создать категорию",
        variant: "destructive",
      });
      return null;
    }

    setCategories(prev => [...prev, data]);
    toast({
      title: "Сфера добавлена",
      description: `Сфера "${name}" успешно создана`,
    });
    return data;
  };

  const updateCategory = async (categoryId: string, name: string, color: string) => {
    if (!user) return false;

    const { error } = await supabase
      .from("task_categories")
      .update({ name, color })
      .eq("id", categoryId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось обновить категорию",
        variant: "destructive",
      });
      return false;
    }

    setCategories(prev => prev.map(c => 
      c.id === categoryId ? { ...c, name, color } : c
    ));
    toast({
      title: "Сфера обновлена",
      description: `Сфера "${name}" успешно обновлена`,
    });
    return true;
  };

  const deleteCategory = async (categoryId: string) => {
    if (!user) return false;

    // Check if category is used in any tasks
    const { data: tasks, error: checkError } = await supabase
      .from("eisenhower_tasks")
      .select("id")
      .eq("category_id", categoryId)
      .eq("user_id", user.id)
      .limit(1);

    if (checkError) {
      console.error("Error checking category usage:", checkError);
    }

    if (tasks && tasks.length > 0) {
      toast({
        title: "Невозможно удалить",
        description: "Эта сфера используется в задачах. Сначала измените сферу у задач.",
        variant: "destructive",
      });
      return false;
    }

    const { error } = await supabase
      .from("task_categories")
      .delete()
      .eq("id", categoryId)
      .eq("user_id", user.id);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить категорию",
        variant: "destructive",
      });
      return false;
    }

    setCategories(prev => prev.filter(c => c.id !== categoryId));
    toast({
      title: "Сфера удалена",
      description: "Сфера успешно удалена",
    });
    return true;
  };

  const canManageCategories = role === "admin" || role === "superadmin";

  return {
    categories,
    loading,
    addCategory,
    updateCategory,
    deleteCategory,
    canManageCategories,
    refetch: fetchCategories,
  };
}
