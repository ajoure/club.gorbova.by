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
    return data;
  };

  const deleteCategory = async (categoryId: string) => {
    if (!user) return false;

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
    return true;
  };

  const canManageCategories = role === "admin" || role === "superadmin";

  return {
    categories,
    loading,
    addCategory,
    deleteCategory,
    canManageCategories,
    refetch: fetchCategories,
  };
}
