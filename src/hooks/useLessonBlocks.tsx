import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type BlockType = 'heading' | 'text' | 'video' | 'audio' | 'image' | 'file' | 'button' | 'embed' | 'divider';

export interface HeadingContent {
  text: string;
  level: 1 | 2 | 3 | 4;
}

export interface TextContent {
  html: string;
}

export interface VideoContent {
  url: string;
  provider?: 'youtube' | 'vimeo' | 'kinescope' | 'other';
  title?: string;
}

export interface AudioContent {
  url: string;
  title?: string;
}

export interface ImageContent {
  url: string;
  alt?: string;
  width?: number;
}

export interface FileContent {
  url: string;
  name: string;
  size?: number;
}

export interface ButtonContent {
  buttons: { label: string; url: string; variant?: string }[];
}

export interface EmbedContent {
  url: string;
  height?: number;
}

export interface BlockSettings {
  alignment?: 'left' | 'center' | 'right';
  padding?: string;
  width?: 'full' | 'wide' | 'narrow';
}

export interface LessonBlock {
  id: string;
  lesson_id: string;
  block_type: BlockType;
  content: HeadingContent | TextContent | VideoContent | AudioContent | ImageContent | FileContent | ButtonContent | EmbedContent | Record<string, never>;
  sort_order: number;
  settings: BlockSettings;
  created_at: string;
  updated_at: string;
}

export interface LessonBlockFormData {
  block_type: BlockType;
  content: LessonBlock['content'];
  sort_order?: number;
  settings?: BlockSettings;
}

export function useLessonBlocks(lessonId?: string) {
  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBlocks = useCallback(async () => {
    if (!lessonId) {
      setBlocks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("lesson_blocks")
        .select("*")
        .eq("lesson_id", lessonId)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setBlocks((data as unknown as LessonBlock[]) || []);
    } catch (error) {
      console.error("Error fetching lesson blocks:", error);
      toast.error("Ошибка загрузки блоков урока");
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const addBlock = async (data: LessonBlockFormData): Promise<LessonBlock | null> => {
    if (!lessonId) return null;

    try {
      // Get max sort_order
      const maxOrder = blocks.length > 0 
        ? Math.max(...blocks.map(b => b.sort_order)) 
        : -1;

      const { data: newBlock, error } = await supabase
        .from("lesson_blocks")
        .insert({
          lesson_id: lessonId,
          block_type: data.block_type,
          content: data.content as unknown as Record<string, unknown>,
          sort_order: data.sort_order ?? maxOrder + 1,
          settings: (data.settings || {}) as unknown as Record<string, unknown>,
        })
        .select()
        .single();

      if (error) throw error;
      
      await fetchBlocks();
      return newBlock as unknown as LessonBlock;
    } catch (error) {
      console.error("Error adding block:", error);
      toast.error("Ошибка добавления блока");
      return null;
    }
  };

  const updateBlock = async (id: string, data: Partial<LessonBlockFormData>): Promise<boolean> => {
    try {
      const updateData: Record<string, unknown> = {};
      if (data.block_type !== undefined) updateData.block_type = data.block_type;
      if (data.content !== undefined) updateData.content = data.content as unknown as Record<string, unknown>;
      if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
      if (data.settings !== undefined) updateData.settings = data.settings as unknown as Record<string, unknown>;

      const { error } = await supabase
        .from("lesson_blocks")
        .update(updateData)
        .eq("id", id);

      if (error) throw error;
      
      await fetchBlocks();
      return true;
    } catch (error) {
      console.error("Error updating block:", error);
      toast.error("Ошибка обновления блока");
      return false;
    }
  };

  const deleteBlock = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("lesson_blocks")
        .delete()
        .eq("id", id);

      if (error) throw error;
      
      await fetchBlocks();
      toast.success("Блок удалён");
      return true;
    } catch (error) {
      console.error("Error deleting block:", error);
      toast.error("Ошибка удаления блока");
      return false;
    }
  };

  const reorderBlocks = async (orderedIds: string[]): Promise<boolean> => {
    try {
      // Update sort_order for each block
      const updates = orderedIds.map((id, index) => 
        supabase
          .from("lesson_blocks")
          .update({ sort_order: index })
          .eq("id", id)
      );

      await Promise.all(updates);
      await fetchBlocks();
      return true;
    } catch (error) {
      console.error("Error reordering blocks:", error);
      toast.error("Ошибка изменения порядка блоков");
      return false;
    }
  };

  const bulkAddBlocks = async (blocksData: LessonBlockFormData[]): Promise<boolean> => {
    if (!lessonId) return false;

    try {
      const maxOrder = blocks.length > 0 
        ? Math.max(...blocks.map(b => b.sort_order)) 
        : -1;

      const insertData = blocksData.map((data, index) => ({
        lesson_id: lessonId,
        block_type: data.block_type,
        content: data.content as unknown as Record<string, unknown>,
        sort_order: data.sort_order ?? maxOrder + 1 + index,
        settings: (data.settings || {}) as unknown as Record<string, unknown>,
      }));

      const { error } = await supabase
        .from("lesson_blocks")
        .insert(insertData);

      if (error) throw error;
      
      await fetchBlocks();
      return true;
    } catch (error) {
      console.error("Error bulk adding blocks:", error);
      toast.error("Ошибка добавления блоков");
      return false;
    }
  };

  return {
    blocks,
    loading,
    refetch: fetchBlocks,
    addBlock,
    updateBlock,
    deleteBlock,
    reorderBlocks,
    bulkAddBlocks,
  };
}
