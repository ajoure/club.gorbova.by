import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type BlockType = 
  // Текстовые
  | 'heading' | 'text' | 'accordion' | 'tabs' | 'spoiler' | 'callout' | 'quote'
  // Медиа  
  | 'video' | 'audio' | 'image' | 'gallery' | 'file'
  // Интерактивные
  | 'button' | 'embed' | 'divider' | 'timeline' | 'steps'
  // Тесты (Итерация 2)
  | 'quiz_single' | 'quiz_multiple' | 'quiz_true_false' | 'quiz_fill_blank' 
  | 'quiz_matching' | 'quiz_sequence' | 'quiz_hotspot'
  // Ввод (Итерация 3)
  | 'input_short' | 'input_long' | 'checklist' | 'table_input' | 'file_upload' | 'rating'
  // Мета (Итерация 4)
  | 'container' | 'columns' | 'condition';

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

// New content types for Iteration 1
export interface AccordionContentData {
  items: { id: string; title: string; content: string }[];
  allowMultiple?: boolean;
}

export interface TabsContentData {
  tabs: { id: string; title: string; content: string }[];
}

export interface SpoilerContentData {
  buttonText: string;
  content: string;
}

export interface CalloutContentData {
  type: 'info' | 'success' | 'warning' | 'error' | 'tip' | 'quote' | 'summary';
  content: string;
  title?: string;
}

export interface QuoteContentData {
  text: string;
  author?: string;
  source?: string;
}

export interface TimelineContentData {
  items: { id: string; title: string; description: string; date?: string }[];
}

export interface StepsContentData {
  steps: { id: string; title: string; description: string }[];
  orientation?: 'vertical' | 'horizontal';
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
  content: HeadingContent | TextContent | VideoContent | AudioContent | ImageContent | FileContent | ButtonContent | EmbedContent | AccordionContentData | TabsContentData | SpoilerContentData | CalloutContentData | QuoteContentData | TimelineContentData | StepsContentData | Record<string, never>;
  sort_order: number;
  settings: BlockSettings;
  parent_id?: string | null;
  visibility_rules?: Record<string, unknown>;
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
        .insert([{
          lesson_id: lessonId,
          block_type: data.block_type,
          content: data.content,
          sort_order: data.sort_order ?? maxOrder + 1,
          settings: data.settings || {},
        }] as any)
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
      if (data.content !== undefined) updateData.content = data.content;
      if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
      if (data.settings !== undefined) updateData.settings = data.settings;

      const { error } = await supabase
        .from("lesson_blocks")
        .update(updateData as any)
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
        content: data.content,
        sort_order: data.sort_order ?? maxOrder + 1 + index,
        settings: data.settings || {},
      }));

      const { error } = await supabase
        .from("lesson_blocks")
        .insert(insertData as any);

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
