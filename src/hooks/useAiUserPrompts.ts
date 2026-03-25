import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface AiUserPrompt {
  id: string;
  code: string;
  title: string;
  description: string | null;
  prompt_text: string;
  type: "chat" | "file_analysis" | "document_review" | "text_transform";
  category: string | null;
  icon: string | null;
  input_hint: string | null;
  response_format: any;
  is_active: boolean;
  is_archived: boolean;
  sort_order: number;
  is_visible_in_chat: boolean;
  launcher_title: string | null;
  launcher_description: string | null;
  launcher_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

type PromptFilter = "active" | "archived" | "all";

export function useAiUserPrompts() {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<AiUserPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<PromptFilter>("active");

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("ai_user_prompts")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false });

      if (filter === "active") {
        query = query.eq("is_archived", false);
      } else if (filter === "archived") {
        query = query.eq("is_archived", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      setPrompts((data as unknown as AiUserPrompt[]) || []);
    } catch (err: any) {
      console.error("Error fetching prompts:", err);
      toast({ title: "Ошибка загрузки промптов", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const createPrompt = useCallback(async (data: Partial<AiUserPrompt>) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("ai_user_prompts").insert(data as any);
      if (error) throw error;
      toast({ title: "Промпт создан" });
      await fetchPrompts();
    } catch (err: any) {
      toast({ title: "Ошибка создания", description: err.message, variant: "destructive" });
      throw err;
    } finally {
      setSaving(false);
    }
  }, [fetchPrompts, toast]);

  const updatePrompt = useCallback(async (id: string, data: Partial<AiUserPrompt>) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("ai_user_prompts").update(data as any).eq("id", id);
      if (error) throw error;
      toast({ title: "Промпт обновлён" });
      await fetchPrompts();
    } catch (err: any) {
      toast({ title: "Ошибка обновления", description: err.message, variant: "destructive" });
      throw err;
    } finally {
      setSaving(false);
    }
  }, [fetchPrompts, toast]);

  const archivePrompt = useCallback(async (id: string) => {
    await updatePrompt(id, { is_archived: true });
  }, [updatePrompt]);

  const toggleVisible = useCallback(async (id: string, currentValue: boolean) => {
    await updatePrompt(id, { is_visible_in_chat: !currentValue });
  }, [updatePrompt]);

  const deletePrompt = useCallback(async (id: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("ai_user_prompts").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Промпт удалён" });
      await fetchPrompts();
    } catch (err: any) {
      toast({ title: "Ошибка удаления", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [fetchPrompts, toast]);

  return {
    prompts,
    loading,
    saving,
    filter,
    setFilter,
    createPrompt,
    updatePrompt,
    archivePrompt,
    toggleVisible,
    deletePrompt,
    refetch: fetchPrompts,
  };
}
