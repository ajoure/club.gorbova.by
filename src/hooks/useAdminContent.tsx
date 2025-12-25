import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ContentItem {
  id: string;
  title: string;
  type: "article" | "video" | "course";
  content: string | null;
  status: "draft" | "published" | "hidden";
  access_level: "free" | "paid" | "premium";
  author_id: string;
  created_at: string;
  updated_at: string;
}

export interface ContentFormData {
  title: string;
  type: "article" | "video" | "course";
  content: string;
  status: "draft" | "published" | "hidden";
  access_level: "free" | "paid" | "premium";
}

export function useAdminContent() {
  const { user } = useAuth();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("content")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("Error fetching content:", error);
        toast.error("Ошибка загрузки контента");
        return;
      }

      setItems((data || []) as ContentItem[]);
    } catch (error) {
      console.error("Error in useAdminContent:", error);
      toast.error("Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const createContent = async (formData: ContentFormData): Promise<boolean> => {
    if (!user) {
      toast.error("Не авторизован");
      return false;
    }

    try {
      const { error } = await supabase.from("content").insert({
        title: formData.title,
        type: formData.type,
        content: formData.content,
        status: formData.status,
        access_level: formData.access_level,
        author_id: user.id,
      });

      if (error) {
        console.error("Error creating content:", error);
        toast.error("Ошибка создания контента");
        return false;
      }

      toast.success("Контент создан");
      await fetchContent();
      return true;
    } catch (error) {
      console.error("Error creating content:", error);
      toast.error("Ошибка создания контента");
      return false;
    }
  };

  const updateContent = async (id: string, formData: Partial<ContentFormData>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("content")
        .update({
          title: formData.title,
          type: formData.type,
          content: formData.content,
          status: formData.status,
          access_level: formData.access_level,
        })
        .eq("id", id);

      if (error) {
        console.error("Error updating content:", error);
        toast.error("Ошибка обновления контента");
        return false;
      }

      toast.success("Контент обновлен");
      await fetchContent();
      return true;
    } catch (error) {
      console.error("Error updating content:", error);
      toast.error("Ошибка обновления контента");
      return false;
    }
  };

  const deleteContent = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase.from("content").delete().eq("id", id);

      if (error) {
        console.error("Error deleting content:", error);
        toast.error("Ошибка удаления контента");
        return false;
      }

      toast.success("Контент удален");
      await fetchContent();
      return true;
    } catch (error) {
      console.error("Error deleting content:", error);
      toast.error("Ошибка удаления контента");
      return false;
    }
  };

  const publishContent = async (id: string): Promise<boolean> => {
    return updateContent(id, { status: "published" });
  };

  const hideContent = async (id: string): Promise<boolean> => {
    return updateContent(id, { status: "hidden" });
  };

  return {
    items,
    loading,
    refetch: fetchContent,
    createContent,
    updateContent,
    deleteContent,
    publishContent,
    hideContent,
  };
}
