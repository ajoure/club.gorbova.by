import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface LessonProgressStateData {
  role?: string;                          // Selected role from quiz_survey
  videoProgress?: Record<string, number>; // blockId -> percent watched
  pointA_rows?: Record<string, unknown>[]; // Diagnostic table data
  pointA_completed?: boolean;
  pointB_answers?: Record<string, string>; // Answers to sequential form steps
  pointB_completed?: boolean;
  pointB_summary?: string;                 // AI-generated summary for Point B
  currentStepIndex?: number;              // Current kvest step
  completedSteps?: string[];              // IDs of completed blocks
}

interface LessonProgressStateRecord {
  id: string;
  user_id: string;
  lesson_id: string;
  state_json: LessonProgressStateData;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useLessonProgressState(lessonId?: string) {
  const { user } = useAuth();
  const [record, setRecord] = useState<LessonProgressStateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStateRef = useRef<LessonProgressStateData | null>(null);

  // Fetch current state
  const fetchState = useCallback(async () => {
    if (!lessonId || !user) {
      setRecord(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("lesson_progress_state")
        .select("*")
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId)
        .maybeSingle();

      if (error) throw error;
      
      setRecord(data ? {
        ...data,
        state_json: (data.state_json || {}) as LessonProgressStateData
      } : null);
    } catch (error) {
      console.error("Error fetching lesson progress state:", error);
    } finally {
      setLoading(false);
    }
  }, [lessonId, user]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Save state to DB (debounced)
  const saveState = useCallback(async (newState: LessonProgressStateData) => {
    if (!lessonId || !user) return;

    try {
      const { data, error } = await supabase
        .from("lesson_progress_state")
        .upsert({
          user_id: user.id,
          lesson_id: lessonId,
          state_json: newState as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'user_id,lesson_id'
        })
        .select()
        .single();

      if (error) throw error;
      
      setRecord({
        ...data,
        state_json: (data.state_json || {}) as LessonProgressStateData
      });
    } catch (error) {
      console.error("Error saving lesson progress state:", error);
    }
  }, [lessonId, user]);

  // Update state with debouncing
  const updateState = useCallback((partial: Partial<LessonProgressStateData>) => {
    const currentState = pendingStateRef.current ?? record?.state_json ?? {};
    const newState = { ...currentState, ...partial };
    
    // Update local state immediately
    pendingStateRef.current = newState;
    setRecord(prev => prev ? {
      ...prev,
      state_json: newState
    } : {
      id: '',
      user_id: user?.id || '',
      lesson_id: lessonId || '',
      state_json: newState,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveState(newState);
      pendingStateRef.current = null;
    }, 500);
  }, [record, user, lessonId, saveState]);

  // Mark a block as completed
  const markBlockCompleted = useCallback((blockId: string) => {
    const currentSteps = record?.state_json?.completedSteps || [];
    if (!currentSteps.includes(blockId)) {
      updateState({
        completedSteps: [...currentSteps, blockId]
      });
    }
  }, [record, updateState]);

  // Check if block is completed
  const isBlockCompleted = useCallback((blockId: string): boolean => {
    return record?.state_json?.completedSteps?.includes(blockId) ?? false;
  }, [record]);

  // Mark entire lesson as completed
  const markLessonCompleted = useCallback(async () => {
    if (!lessonId || !user) return;

    try {
      const { error } = await supabase
        .from("lesson_progress_state")
        .upsert({
          user_id: user.id,
          lesson_id: lessonId,
          state_json: record?.state_json || {},
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'user_id,lesson_id'
        });

      if (error) throw error;
      await fetchState();
    } catch (error) {
      console.error("Error marking lesson completed:", error);
    }
  }, [lessonId, user, record, fetchState]);

  // Reset progress
  const reset = useCallback(async () => {
    if (!lessonId || !user) return;

    try {
      const { error } = await supabase
        .from("lesson_progress_state")
        .delete()
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId);

      if (error) throw error;
      
      setRecord(null);
      pendingStateRef.current = null;
    } catch (error) {
      console.error("Error resetting lesson progress:", error);
    }
  }, [lessonId, user]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    state: record?.state_json ?? null,
    isCompleted: !!record?.completed_at,
    loading,
    updateState,
    markBlockCompleted,
    isBlockCompleted,
    markLessonCompleted,
    reset,
    refetch: fetchState,
  };
}
