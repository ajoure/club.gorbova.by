import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, CheckCircle2, Lock, ChevronDown } from "lucide-react";
import { LessonBlock, BlockType } from "@/hooks/useLessonBlocks";
import { TrainingLesson } from "@/hooks/useTrainingLessons";
import { useLessonProgressState, LessonProgressStateData } from "@/hooks/useLessonProgressState";
import { useResetProgress } from "@/hooks/useResetProgress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LessonBlockRenderer } from "./LessonBlockRenderer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { prefillV2FromV1, isDiagnosticV2 } from "@/lib/diagnosticTableV1toV2";
// findV1DiagnosticSource removed — prefill logic inlined with user data check

// Block types that count as "steps" in kvest mode
const STEP_BLOCK_TYPES: BlockType[] = [
  'quiz_survey',
  'role_description',
  'video_unskippable',
  'video',
  'diagnostic_table',
  'sequential_form',
  'text',
  'callout',
  'accordion',
  'tabs',
  'steps',
  'timeline',
];

// Block types that DON'T count as steps (decorative/structural)
const NON_STEP_BLOCK_TYPES: BlockType[] = [
  'heading',
  'divider',
  'image',
];

interface KvestLessonViewProps {
  lesson: TrainingLesson;
  blocks: LessonBlock[];
  moduleSlug: string;
  onComplete: () => Promise<void>;
  /** User is admin (for UI hints) */
  isAdminMode?: boolean;
  /** Admin in preview mode — can bypass empty video URL */
  allowBypassEmptyVideo?: boolean;
}

export function KvestLessonView({ 
  lesson, 
  blocks, 
  moduleSlug, 
  onComplete,
  isAdminMode = false,
  allowBypassEmptyVideo = false
}: KvestLessonViewProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { state, loading: progressLoading, saveStatus, updateState, markBlockCompleted, isBlockCompleted, markLessonCompleted, refetch: refetchProgress } = useLessonProgressState(lesson.id);
  const { resetProgress: resetViaEdge } = useResetProgress();
  const blockRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const userNavigatedRef = useRef(false);
  
  // Filter blocks that are "steps"
  const stepBlocks = useMemo(() => 
    blocks.filter(b => !NON_STEP_BLOCK_TYPES.includes(b.block_type)),
    [blocks]
  );
  
  // Current step index from state or default to 0
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(
    state?.currentStepIndex ?? 0
  );

  // Sync with saved state — guard against transient null during background refetch
  useEffect(() => {
    // If state is null/undefined (e.g. during refetch), do NOT reset currentStepIndex
    if (state == null) return;
    if (state.currentStepIndex !== undefined && state.currentStepIndex !== currentStepIndex) {
      setCurrentStepIndex(state.currentStepIndex);
    }
  }, [state?.currentStepIndex]);

  // ── V2 Prefill: auto-discover V1 source or use override ──
  const v2PrefillDoneRef = useRef(false);
  const [v2PrefillInfo, setV2PrefillInfo] = useState<string | null>(null);
  useEffect(() => {
    if (v2PrefillDoneRef.current) return;
    // Wait for progress state to finish loading — don't block on !state
    if (progressLoading) return;
    if (!user?.id) return;

    const v2Block = stepBlocks.find(b =>
      b.block_type === 'diagnostic_table' && isDiagnosticV2(b.content)
    );
    if (!v2Block) {
      v2PrefillDoneRef.current = true;
      return;
    }

    // Strict guard: if V2 rows already exist (from DB or manual), never overwrite
    const v2Rows = state?.pointA_v2_rows;
    if (v2Rows && v2Rows.length > 0) {
      v2PrefillDoneRef.current = true;
      return;
    }

    const doPrefill = async () => {
      try {
        const overrideId = (v2Block.content as any)?.source_lesson_id || '';

        // Get current lesson info for auto-discover
        const { data: lessonInfo } = await supabase
          .from('training_lessons')
          .select('module_id, sort_order')
          .eq('id', lesson.id)
          .single();

        if (!lessonInfo) {
          console.log('[V2 Prefill] Could not fetch lesson info');
          v2PrefillDoneRef.current = true;
          return;
        }

        // Step 1: Try override first
        let sourceLessonId: string | null = null;
        let method = 'auto';

        if (overrideId && overrideId.length > 10) {
          // Validate override has actual user data
          const { data: overrideState } = await supabase
            .from('lesson_progress_state')
            .select('state_json')
            .eq('user_id', user.id)
            .eq('lesson_id', overrideId)
            .maybeSingle();

          const overrideRows = (overrideState?.state_json as any)?.pointA_rows;
          if (overrideRows && Array.isArray(overrideRows) && overrideRows.length > 0) {
            sourceLessonId = overrideId;
            method = 'override';
          } else {
            console.log('[V2 Prefill] Override lesson has no pointA_rows for this user');
          }
        }

        // Step 2: Auto-discover — find previous lesson with V1 block AND user data
        if (!sourceLessonId) {
          const { data: candidates } = await supabase
            .from('training_lessons')
            .select('id, title, sort_order')
            .eq('module_id', lessonInfo.module_id)
            .eq('is_active', true)
            .neq('id', lesson.id)
            .lt('sort_order', lessonInfo.sort_order)
            .order('sort_order', { ascending: false })
            .limit(10);

          if (candidates?.length) {
            for (const candidate of candidates) {
              // Check candidate has V1 diagnostic_table block
              const { data: blocks } = await supabase
                .from('lesson_blocks')
                .select('id, content')
                .eq('lesson_id', candidate.id)
                .eq('block_type', 'diagnostic_table');

              const hasV1 = blocks?.some(b => {
                const ver = (b.content as any)?.version;
                return !ver || ver !== 'v2';
              });
              if (!hasV1) continue;

              // Check user has pointA_rows for this lesson
              const { data: progressData } = await supabase
                .from('lesson_progress_state')
                .select('state_json')
                .eq('user_id', user.id)
                .eq('lesson_id', candidate.id)
                .maybeSingle();

              const rows = (progressData?.state_json as any)?.pointA_rows;
              if (rows && Array.isArray(rows) && rows.length > 0) {
                sourceLessonId = candidate.id;
                method = 'auto';
                console.log(`[V2 Prefill] Found source: ${candidate.title} (${candidate.id.slice(0,8)}), ${rows.length} rows`);
                break;
              }
            }
          }
        }

        if (!sourceLessonId) {
          console.log('[V2 Prefill] No V1 source with user data found — user fills manually');
          setV2PrefillInfo('auto_not_found');
          v2PrefillDoneRef.current = true;
          return;
        }

        // Fetch V1 rows from the found source
        const { data: sourceData, error } = await supabase
          .from('lesson_progress_state')
          .select('state_json')
          .eq('user_id', user.id)
          .eq('lesson_id', sourceLessonId)
          .maybeSingle();

        if (error) {
          console.error('[V2 Prefill] DB error:', error);
          v2PrefillDoneRef.current = true;
          return;
        }

        const v1Rows = (sourceData?.state_json as any)?.pointA_rows;
        if (!v1Rows || !Array.isArray(v1Rows) || v1Rows.length === 0) {
          console.log('[V2 Prefill] Source has no V1 rows (race condition?)');
          v2PrefillDoneRef.current = true;
          return;
        }

        const prefilled = prefillV2FromV1(v1Rows);
        updateState({ pointA_v2_rows: prefilled });
        console.log(`[V2 Prefill] Imported ${prefilled.length} rows from ${sourceLessonId.slice(0, 8)} (${method})`);
      } catch (err) {
        console.error('[V2 Prefill] Unexpected error:', err);
      } finally {
        v2PrefillDoneRef.current = true;
      }
    };
    doPrefill();
  }, [progressLoading, state, stepBlocks, updateState, user?.id, lesson.id]);

  const totalSteps = stepBlocks.length;
  const progressPercent = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  // Check if a specific block's gate is open
  const isBlockGateOpen = useCallback((block: LessonBlock, idx: number): boolean => {
    if (isBlockCompleted(block.id)) return true;
    
    const blockType = block.block_type;
    
    switch (blockType) {
      case 'quiz_survey':
        return !!state?.role;
      
      case 'role_description':
        return isBlockCompleted(block.id);
      
      case 'video_unskippable': {
        const videoUrl = ((block.content as any)?.url || '').trim();
        if (!videoUrl) {
          return allowBypassEmptyVideo === true;
        }
        return false;
      }
      
      case 'video':
        return true;
      
      case 'diagnostic_table': {
        if (isDiagnosticV2(block.content)) {
          const hasV2Rows = (state?.pointA_v2_rows?.length ?? 0) > 0;
          return hasV2Rows && state?.pointA_v2_completed === true;
        }
        const hasRows = (state?.pointA_rows?.length ?? 0) > 0;
        return hasRows && state?.pointA_completed === true;
      }
      
      case 'sequential_form':
        return state?.pointB_completed === true;
      
      default:
        return true;
    }
  }, [state, isBlockCompleted]);

  const currentBlock = stepBlocks[currentStepIndex];
  const isCurrentBlockGateOpen = currentBlock ? isBlockGateOpen(currentBlock, currentStepIndex) : false;

  // Scroll to block — only on explicit user action
  const scrollToBlock = useCallback((blockId: string) => {
    if (!userNavigatedRef.current) return; // guard: no scroll unless user explicitly navigated
    userNavigatedRef.current = false;
    const el = blockRefs.current.get(blockId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // Navigate to step — scroll only on explicit navigation
  const goToStep = useCallback((index: number, force = false) => {
    if (index < 0 || index >= totalSteps) return;
    
    // Mark as user navigation so scrollToBlock will fire
    userNavigatedRef.current = true;
    
    if (index < currentStepIndex) {
      setCurrentStepIndex(index);
      updateState({ currentStepIndex: index });
      const block = stepBlocks[index];
      if (block) scrollToBlock(block.id);
      return;
    }
    
    if (index > currentStepIndex && !force && !isCurrentBlockGateOpen) {
      userNavigatedRef.current = false;
      toast.error("Сначала завершите текущий шаг");
      return;
    }
    
    if (index > currentStepIndex && currentBlock) {
      markBlockCompleted(currentBlock.id);
    }
    
    setCurrentStepIndex(index);
    updateState({ currentStepIndex: index });
    
    setTimeout(() => {
      const block = stepBlocks[index];
      if (block) scrollToBlock(block.id);
    }, 100);
  }, [currentStepIndex, totalSteps, isCurrentBlockGateOpen, currentBlock, markBlockCompleted, updateState, stepBlocks, scrollToBlock]);

  const handleFinishLesson = useCallback(async () => {
    if (currentBlock) {
      markBlockCompleted(currentBlock.id);
    }
    await markLessonCompleted();
    await onComplete();
    toast.success("Урок пройден! 🎉");
  }, [currentBlock, markBlockCompleted, markLessonCompleted, onComplete]);

  const isLastStep = currentStepIndex === totalSteps - 1;

  const handleRoleSelected = useCallback((role: string) => {
    updateState({ role });
  }, [updateState]);

  const handleQuizSurveyReset = useCallback(async (blockId: string) => {
    console.log('[KvestLessonView] Quiz reset via Edge Function:', blockId.slice(0, 8));
    const result = await resetViaEdge(lesson.id, 'quiz_only', blockId);
    if (!result.ok) {
      console.error('[KvestLessonView] Reset failed:', result.error);
      return;
    }
    await refetchProgress();
    setCurrentStepIndex(0);
    console.log('[KvestLessonView] Reset success:', result);
  }, [lesson.id, resetViaEdge, refetchProgress]);

  const handleRoleDescriptionComplete = useCallback((blockId: string) => {
    markBlockCompleted(blockId);
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1, true);
    }
  }, [markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  const handleVideoComplete = useCallback((blockId: string) => {
    markBlockCompleted(blockId);
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1, true);
    }
  }, [markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  // V1 diagnostic table handlers
  const handleDiagnosticTableUpdate = useCallback((rows: Record<string, unknown>[]) => {
    updateState({ pointA_rows: rows });
  }, [updateState]);

  const handleDiagnosticTableComplete = useCallback((blockId: string) => {
    updateState({ pointA_completed: true });
    markBlockCompleted(blockId);
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1, true);
    }
  }, [updateState, markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  const handleDiagnosticTableReset = useCallback((blockId: string) => {
    console.log('[KvestLessonView] DiagnosticTable V1 reset:', blockId.slice(0, 8));
    updateState({ 
      pointA_completed: false,
      completedSteps: (state?.completedSteps || []).filter(id => id !== blockId),
      currentStepIndex: currentStepIndex,
    });
    toast.success("Вы можете отредактировать данные");
  }, [state?.completedSteps, currentStepIndex, updateState]);

  const handleDiagnosticTableV2Update = useCallback((rows: Record<string, unknown>[]) => {
    updateState({ pointA_v2_rows: rows as any });
  }, [updateState]);

  const handleDiagnosticTableV2Complete = useCallback((blockId: string) => {
    updateState({ pointA_v2_completed: true });
    markBlockCompleted(blockId);
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1, true);
    }
  }, [updateState, markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  const handleDiagnosticTableV2Reset = useCallback((blockId: string) => {
    console.log('[KvestLessonView] DiagnosticTable V2 reset:', blockId.slice(0, 8));
    updateState({ 
      pointA_v2_completed: false,
      completedSteps: (state?.completedSteps || []).filter(id => id !== blockId),
      currentStepIndex: currentStepIndex,
    });
    toast.success("Вы можете отредактировать данные");
  }, [state?.completedSteps, currentStepIndex, updateState]);

  // Sequential form handlers
  const handleSequentialFormUpdate = useCallback((answers: Record<string, string>) => {
    updateState({ pointB_answers: answers });
  }, [updateState]);

  const handleSequentialFormComplete = useCallback((blockId: string) => {
    updateState({ pointB_completed: true });
    markBlockCompleted(blockId);
  }, [updateState, markBlockCompleted]);

  const handleSequentialFormReset = useCallback((blockId: string) => {
    console.log('[KvestLessonView] SequentialForm reset:', blockId.slice(0, 8));
    updateState({ 
      pointB_completed: false,
      pointB_answers: {},
      pointB_summary: undefined,
      completedSteps: (state?.completedSteps || []).filter(id => id !== blockId)
    });
    toast.success("Данные сброшены — можете заполнить заново");
  }, [state?.completedSteps, updateState]);

  const handleSummaryGenerated = useCallback((summary: string) => {
    updateState({ pointB_summary: summary });
  }, [updateState]);

  const savedSummary = useMemo(() => state?.pointB_summary || undefined, [state?.pointB_summary]);

  const pointARows = useMemo(() => state?.pointA_rows || [], [state?.pointA_rows]);
  const pointAV2Rows = useMemo(() => (state?.pointA_v2_rows || []) as unknown as Record<string, unknown>[], [state?.pointA_v2_rows]);
  const pointBAnswers = useMemo(() => state?.pointB_answers || {}, [state?.pointB_answers]);
  const userRole = useMemo(() => state?.role || null, [state?.role]);

  // Render block with kvest-specific props
  const renderBlockWithProps = useCallback((block: LessonBlock, isCompleted: boolean, isCurrent: boolean) => {
    const blockType = block.block_type;
    const blockId = block.id;
    
    const commonProps = {
      blocks: [block],
      lessonId: lesson.id,
    };

    const isReadOnly = isCompleted && !isCurrent;

    switch (blockType) {
      case 'quiz_survey':
        return (
          <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                onRoleSelected: isReadOnly ? undefined : handleRoleSelected,
                isCompleted: isCompleted,
                onQuizReset: isReadOnly ? undefined : async () => {
                  await handleQuizSurveyReset(blockId);
                },
              }}
            />
          </div>
        );
      
      case 'role_description':
        return (
          <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                role: userRole,
                onComplete: isReadOnly ? undefined : () => handleRoleDescriptionComplete(blockId),
                isCompleted: isCompleted,
              }}
            />
          </div>
        );
      
      case 'video_unskippable': {
        const stableKey = `${blockId}-${isCompleted ? 'completed' : 'active'}`;
        // Video stays interactive even when completed — user can rewatch
        return (
          <div key={stableKey}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                onComplete: isReadOnly ? undefined : () => handleVideoComplete(blockId),
                isCompleted: isCompleted,
                allowBypassEmptyVideo: allowBypassEmptyVideo,
              }}
            />
          </div>
        );
      }
      
      case 'diagnostic_table': {
        if (isDiagnosticV2(block.content)) {
          // V2: rows come from state (prefill handled by useEffect above)
          return (
            <div>
              <LessonBlockRenderer
                {...commonProps}
                kvestProps={{
                  rows: pointAV2Rows,
                  onRowsChange: isReadOnly ? undefined : handleDiagnosticTableV2Update,
                  onComplete: isReadOnly ? undefined : () => handleDiagnosticTableV2Complete(blockId),
                  isCompleted: state?.pointA_v2_completed || false,
                  onReset: (state?.pointA_v2_completed) ? () => handleDiagnosticTableV2Reset(blockId) : undefined,
                  saveStatus: saveStatus,
                }}
              />
            </div>
          );
        }
        // V1
        return (
          <div className={isReadOnly ? "opacity-80" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                rows: pointARows,
                onRowsChange: isReadOnly ? undefined : handleDiagnosticTableUpdate,
                onComplete: isReadOnly ? undefined : () => handleDiagnosticTableComplete(blockId),
                isCompleted: state?.pointA_completed || false,
                onReset: (state?.pointA_completed) ? () => handleDiagnosticTableReset(blockId) : undefined,
              }}
            />
          </div>
        );
      }
      
      case 'sequential_form':
        return (
          <div className={isReadOnly ? "opacity-80" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                answers: pointBAnswers,
                onAnswersChange: isReadOnly ? undefined : handleSequentialFormUpdate,
                onComplete: isReadOnly ? undefined : () => handleSequentialFormComplete(blockId),
                isCompleted: state?.pointB_completed || false,
                savedSummary: savedSummary,
                onSummaryGenerated: isReadOnly ? undefined : handleSummaryGenerated,
                onReset: (state?.pointB_completed) ? () => handleSequentialFormReset(blockId) : undefined,
              }}
            />
          </div>
        );
      
      default:
        return (
          <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
            <LessonBlockRenderer {...commonProps} />
          </div>
        );
    }
  }, [
    lesson.id, 
    state, 
    userRole,
    pointARows,
    pointAV2Rows,
    pointBAnswers,
    savedSummary,
    handleRoleSelected,
    handleQuizSurveyReset,
    handleRoleDescriptionComplete,
    handleVideoComplete,
    handleDiagnosticTableUpdate,
    handleDiagnosticTableComplete,
    handleDiagnosticTableReset,
    handleDiagnosticTableV2Update,
    handleDiagnosticTableV2Complete,
    handleDiagnosticTableV2Reset,
    handleSequentialFormUpdate,
    handleSequentialFormComplete,
    handleSequentialFormReset,
    handleSummaryGenerated,
  ]);

  const getGateExplanation = useCallback((block: LessonBlock): string => {
    switch (block.block_type) {
      case 'quiz_survey':
        return "Выберите ответ и получите результат, чтобы продолжить";
      case 'role_description':
        return "Прочитайте описание и нажмите кнопку перехода";
      case 'video_unskippable':
        return "Досмотрите видео до конца и подтвердите просмотр";
      case 'diagnostic_table':
        return "Добавьте минимум одну строку и нажмите кнопку завершения";
      case 'sequential_form':
        return "Заполните все шаги и нажмите кнопку завершения";
      default:
        return "Выполните действие, чтобы продолжить";
    }
  }, []);

  if (stepBlocks.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Нет шагов для прохождения</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <div 
        className="sticky top-0 z-10 rounded-2xl backdrop-blur-2xl border border-primary/30 shadow-xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))",
          boxShadow: "0 12px 40px hsl(var(--primary) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
        }}
      >
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">{lesson.title}</h3>
            <Badge 
              variant="outline" 
              className="text-sm backdrop-blur-sm bg-white/20 border-white/30"
            >
              Шаг {currentStepIndex + 1} из {totalSteps}
            </Badge>
          </div>
          
          <Progress value={progressPercent} className="h-2 mb-3" />
          
          <div className="flex justify-between flex-wrap gap-1">
            {stepBlocks.map((block, idx) => {
              const completed = isBlockCompleted(block.id);
              const isCurrent = idx === currentStepIndex;
              const isAccessible = idx <= currentStepIndex || completed;
              
              return (
                 <button
                  key={block.id}
                  onClick={() => {
                    userNavigatedRef.current = true;
                    if (isAccessible) goToStep(idx);
                  }}
                  disabled={!isAccessible}
                  title={`Шаг ${idx + 1}`}
                  className={cn(
                    "w-8 h-8 rounded-xl text-xs font-medium transition-all flex items-center justify-center backdrop-blur-sm",
                    completed
                      ? "bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30"
                      : isCurrent
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 shadow-lg"
                        : isAccessible
                          ? "bg-white/40 text-foreground hover:bg-white/60 border border-white/30"
                          : "bg-muted/50 text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {completed ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : !isAccessible ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    idx + 1
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cumulative Block Rendering */}
      <div className="space-y-4">
        {stepBlocks.map((block, idx) => {
          const isVisible = idx <= currentStepIndex;
          const isCompleted = isBlockCompleted(block.id);
          const isCurrent = idx === currentStepIndex;
          const gateOpen = isBlockGateOpen(block, idx);
          
          if (!isVisible) return null;
          
          return (
            <div 
              key={block.id}
              ref={(el) => {
                if (el) blockRefs.current.set(block.id, el);
              }}
              className={cn(
                "rounded-2xl backdrop-blur-xl border transition-all duration-300 overflow-hidden",
                isCompleted && !isCurrent 
                  ? "border-primary/30 shadow-md"
                  : isCurrent 
                    ? "border-primary/40 ring-2 ring-primary/30 shadow-xl"
                    : "border-border/40 shadow-lg"
              )}
              style={{
                background: isCompleted && !isCurrent
                  ? "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))"
                  : isCurrent
                    ? "linear-gradient(135deg, hsl(var(--card) / 0.7), hsl(var(--card) / 0.4))"
                    : "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.25))",
                boxShadow: isCurrent 
                  ? "0 16px 48px rgba(0, 0, 0, 0.1), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
                  : "0 8px 32px rgba(0, 0, 0, 0.06), inset 0 1px 0 hsl(0 0% 100% / 0.15)"
              }}
            >
              {/* Block header */}
              <div className={cn(
                "px-4 py-3 border-b border-white/10 flex items-center justify-between",
                isCompleted 
                  ? "bg-gradient-to-r from-primary/15 to-primary/5" 
                  : isCurrent 
                    ? "bg-gradient-to-r from-primary/10 to-transparent" 
                    : "bg-white/5"
              )}>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant={isCompleted ? "default" : isCurrent ? "secondary" : "outline"}
                    className={cn(
                      "text-xs",
                      isCompleted && "bg-primary hover:bg-primary/90"
                    )}
                  >
                    Шаг {idx + 1}
                  </Badge>
                  {block.block_type === 'quiz_survey' && <span className="text-sm text-muted-foreground">Тест</span>}
                  {block.block_type === 'role_description' && <span className="text-sm text-muted-foreground">Описание роли</span>}
                  {block.block_type === 'video_unskippable' && <span className="text-sm text-muted-foreground">Видео</span>}
                  {block.block_type === 'diagnostic_table' && (
                    <span className="text-sm text-muted-foreground">
                      {isDiagnosticV2(block.content) ? 'Аналитика портфеля' : 'Точка А'}
                    </span>
                  )}
                  {block.block_type === 'sequential_form' && <span className="text-sm text-muted-foreground">Точка Б</span>}
                </div>
                {isCompleted && (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                )}
              </div>
              
              <CardContent className="py-6">
                {renderBlockWithProps(block, isCompleted, isCurrent)}
              </CardContent>

              {/* Gate explanation */}
              {isCurrent && !gateOpen && (
                <div className="px-4 py-3 border-t border-destructive/20 bg-destructive/10 text-center text-sm text-destructive backdrop-blur-sm">
                  {getGateExplanation(block)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Next step */}
      {isCurrentBlockGateOpen && !isLastStep && (
        <div className="flex justify-center">
          <Button
            onClick={() => goToStep(currentStepIndex + 1)}
            className="gap-2 bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25 border-0"
            size="lg"
          >
            Перейти к следующему шагу
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Final step */}
      {isLastStep && isCurrentBlockGateOpen && (
        <div className="flex justify-center">
          <Button
            onClick={handleFinishLesson}
            variant="default"
            size="lg"
            className="gap-2 bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25 border-0"
          >
            <CheckCircle2 className="h-5 w-5" />
            Завершить урок
          </Button>
        </div>
      )}

      {/* Navigation bar */}
      <div className="flex items-center justify-between gap-4 pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => goToStep(currentStepIndex - 1)}
          disabled={currentStepIndex === 0}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Назад
        </Button>

        <span className="text-sm text-muted-foreground">
          {currentStepIndex + 1} / {totalSteps}
        </span>

        <Button
          onClick={() => goToStep(currentStepIndex + 1)}
          disabled={!isCurrentBlockGateOpen || isLastStep}
        >
          Дальше
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
