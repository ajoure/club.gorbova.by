import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface ResetResult {
  ok: boolean;
  affected?: { lesson_progress_state: number; user_lesson_progress: number };
  clearedKeys?: string[];
  error?: string;
}

export function useResetProgress() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const resetProgress = async (
    lessonId: string,
    scope: "quiz_only" | "lesson_all",
    blockId?: string,
    targetUserId?: string  // For admin impersonation
  ): Promise<ResetResult> => {
    if (!user) return { ok: false, error: 'Not authenticated' };

    try {
      const { data, error } = await supabase.functions.invoke('reset-lesson-progress', {
        body: {
          lesson_id: lessonId,
          target_user_id: targetUserId,
          scope,
          block_id: blockId,
        }
      });

      if (error) throw error;

      // Invalidate all progress queries
      queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
      queryClient.invalidateQueries({ queryKey: ['user-progress', lessonId] });

      console.log(`[useResetProgress] Reset complete: scope=${scope}, lesson=${lessonId.slice(0,8)}`);
      return data as ResetResult;

    } catch (error: any) {
      console.error('[useResetProgress] Error:', error);
      return { ok: false, error: error.message };
    }
  };

  return { resetProgress };
}
