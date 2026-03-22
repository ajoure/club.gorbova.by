import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import type { DiagnosticTableV2Row } from "@/lib/diagnosticTableV1toV2";

export interface LessonProgressStateData {
  role?: string;                          // Selected role from quiz_survey
  videoProgress?: Record<string, number>; // blockId -> percent watched
  pointA_rows?: Record<string, unknown>[]; // Diagnostic table V1 data
  pointA_completed?: boolean;
  pointA_v2_rows?: DiagnosticTableV2Row[]; // Diagnostic table V2 data (typed)
  pointA_v2_completed?: boolean;
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
  const queryClient = useQueryClient();
  const [record, setRecord] = useState<LessonProgressStateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStateRef = useRef<LessonProgressStateData | null>(null);
  const saveStatusResetRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedJsonRef = useRef<string | null>(null);

  // Stable user ID ref — prevents refetch on object identity churn (e.g. TOKEN_REFRESHED)
  const userIdRef = useRef<string | undefined>(user?.id);
  userIdRef.current = user?.id;

  // Fetch current state
  const fetchState = useCallback(async () => {
    const uid = userIdRef.current;
    if (!lessonId || !uid) {
      setRecord(null);
      setLoading(false);
      return;
    }

    // Only show loading on initial fetch, not on background refetch (prevents DOM collapse)
    const isInitialFetch = !record;
    if (isInitialFetch) {
      setLoading(true);
    }

    try {
      const { data, error } = await supabase
        .from("lesson_progress_state")
        .select("*")
        .eq("user_id", uid)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, user?.id]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Save state to DB (debounced)
  const saveState = useCallback(async (newState: LessonProgressStateData) => {
    const uid = userIdRef.current;
    if (!lessonId || !uid) return;

    // Skip save if data is identical to last saved version
    const newJson = JSON.stringify(newState);
    if (lastSavedJsonRef.current === newJson) {
      return;
    }

    try {
      setSaveStatus('saving');
      const { data, error } = await supabase
        .from("lesson_progress_state")
        .upsert({
          user_id: uid,
          lesson_id: lessonId,
          state_json: newState as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: 'user_id,lesson_id'
        })
        .select()
        .single();

      if (error) throw error;
      
      lastSavedJsonRef.current = newJson;
      setRecord({
        ...data,
        state_json: (data.state_json || {}) as LessonProgressStateData
      });
      
      setSaveStatus('saved');
      if (saveStatusResetRef.current) clearTimeout(saveStatusResetRef.current);
      saveStatusResetRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error("Error saving lesson progress state:", error);
      setSaveStatus('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, user?.id]);

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
      user_id: userIdRef.current || '',
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
  // Исправление 2: читаем completedSteps из pendingStateRef.current (не из stale record)
  const markBlockCompleted = useCallback((blockId: string) => {
    const currentState = pendingStateRef.current ?? record?.state_json ?? {};
    const currentSteps = currentState.completedSteps || [];
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

  // Reset progress - now just clears local state and refetches
  // Actual deletion is done via Edge Function (service role)
  const reset = useCallback(async () => {
    // Cancel any pending saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    // Clear local state
    setRecord(null);
    pendingStateRef.current = null;
    
    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
    
    // Refetch from DB
    await fetchState();
    
    return { ok: true };
  }, [fetchState, queryClient]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (saveStatusResetRef.current) {
        clearTimeout(saveStatusResetRef.current);
      }
    };
  }, []);

  return {
    state: record?.state_json ?? null,
    isCompleted: !!record?.completed_at,
    loading,
    saveStatus,
    updateState,
    markBlockCompleted,
    isBlockCompleted,
    markLessonCompleted,
    reset,
    refetch: fetchState,
  };
}
