import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface BlockProgress {
  id: string;
  block_id: string;
  response: Record<string, unknown>;
  is_correct: boolean | null;
  score: number;
  max_score: number;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  time_spent_seconds: number;
}

export interface LessonProgress {
  lessonId: string;
  blockProgress: Record<string, BlockProgress>;
  totalScore: number;
  maxScore: number;
  completedBlocks: number;
  totalBlocks: number;
  isCompleted: boolean;
}

export function useUserProgress(lessonId: string) {
  const { user } = useAuth();
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProgress = useCallback(async () => {
    if (!user?.id || !lessonId) {
      setProgress(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from("user_lesson_progress")
        .select("*")
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId);

      if (error) throw error;

      const blockProgress: Record<string, BlockProgress> = {};
      let totalScore = 0;
      let maxScore = 0;
      let completedBlocks = 0;

      (data || []).forEach((item: any) => {
        if (item.block_id) {
          blockProgress[item.block_id] = {
            id: item.id,
            block_id: item.block_id,
            response: item.response || {},
            is_correct: item.is_correct,
            score: item.score || 0,
            max_score: item.max_score || 0,
            attempts: item.attempts || 0,
            started_at: item.started_at,
            completed_at: item.completed_at,
            time_spent_seconds: item.time_spent_seconds || 0,
          };
          totalScore += item.score || 0;
          maxScore += item.max_score || 0;
          if (item.completed_at) completedBlocks++;
        }
      });

      setProgress({
        lessonId,
        blockProgress,
        totalScore,
        maxScore,
        completedBlocks,
        totalBlocks: Object.keys(blockProgress).length,
        isCompleted: false, // Will be set based on all blocks
      });
    } catch (error) {
      console.error("Error fetching progress:", error);
    } finally {
      setLoading(false);
    }
  }, [user?.id, lessonId]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  const saveBlockResponse = async (
    blockId: string,
    response: Record<string, unknown>,
    isCorrect: boolean | null,
    score: number,
    maxScore: number
  ): Promise<boolean> => {
    // TEMP DEBUG LOG - Remove after runtime proof
    console.log('[saveBlockResponse] INPUT:', {
      userId: user?.id,
      lessonId,
      blockId,
      response,
      isCorrect,
      score,
      maxScore
    });

    if (!user?.id || !lessonId) {
      console.warn('[saveBlockResponse] ABORT: missing user or lessonId', { userId: user?.id, lessonId });
      return false;
    }

    try {
      const existingProgress = progress?.blockProgress[blockId];
      const attempts = (existingProgress?.attempts || 0) + 1;

      const progressData = {
        user_id: user.id,
        lesson_id: lessonId,
        block_id: blockId,
        response,
        is_correct: isCorrect,
        score,
        max_score: maxScore,
        attempts,
        completed_at: isCorrect !== null ? new Date().toISOString() : null,
        started_at: existingProgress?.started_at || new Date().toISOString(),
      };

      console.log('[saveBlockResponse] Upserting:', progressData);

      const { data, error } = await supabase
        .from("user_lesson_progress")
        .upsert(progressData as any, {
          onConflict: "user_id,lesson_id,block_id",
        });

      // TEMP DEBUG LOG - Remove after runtime proof
      console.log('[saveBlockResponse] RESULT:', { data, error });

      if (error) throw error;

      await fetchProgress();
      return true;
    } catch (error) {
      console.error("[saveBlockResponse] ERROR:", error);
      return false;
    }
  };

  const getBlockProgress = (blockId: string): BlockProgress | null => {
    return progress?.blockProgress[blockId] || null;
  };

  const resetBlockProgress = async (blockId: string): Promise<boolean> => {
    if (!user?.id || !lessonId) return false;

    try {
      const { error } = await supabase
        .from("user_lesson_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId)
        .eq("block_id", blockId);

      if (error) throw error;

      await fetchProgress();
      return true;
    } catch (error) {
      console.error("Error resetting block progress:", error);
      return false;
    }
  };

  const resetLessonProgress = async (): Promise<boolean> => {
    if (!user?.id || !lessonId) return false;

    try {
      const { error } = await supabase
        .from("user_lesson_progress")
        .delete()
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId);

      if (error) throw error;

      await fetchProgress();
      return true;
    } catch (error) {
      console.error("Error resetting lesson progress:", error);
      return false;
    }
  };

  return {
    progress,
    loading,
    refetch: fetchProgress,
    saveBlockResponse,
    getBlockProgress,
    resetBlockProgress,
    resetLessonProgress,
  };
}
