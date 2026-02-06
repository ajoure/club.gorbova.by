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
import { LessonBlockRenderer } from "./LessonBlockRenderer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const { state, updateState, markBlockCompleted, isBlockCompleted, markLessonCompleted, refetch: refetchProgress } = useLessonProgressState(lesson.id);
  const { resetProgress: resetViaEdge } = useResetProgress();
  const blockRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // Filter blocks that are "steps"
  const stepBlocks = useMemo(() => 
    blocks.filter(b => !NON_STEP_BLOCK_TYPES.includes(b.block_type)),
    [blocks]
  );
  
  // Current step index from state or default to 0
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(
    state?.currentStepIndex ?? 0
  );

  // Sync with saved state
  useEffect(() => {
    if (state?.currentStepIndex !== undefined && state.currentStepIndex !== currentStepIndex) {
      setCurrentStepIndex(state.currentStepIndex);
    }
  }, [state?.currentStepIndex]);

  const totalSteps = stepBlocks.length;
  const progressPercent = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  // Check if a specific block's gate is open
  const isBlockGateOpen = useCallback((block: LessonBlock, idx: number): boolean => {
    // Already completed blocks are always open
    if (isBlockCompleted(block.id)) return true;
    
    const blockType = block.block_type;
    
    // Specific gate rules per block type
    switch (blockType) {
      case 'quiz_survey':
        return !!state?.role;
      
      case 'role_description':
        // Gate opens when button clicked (block marked completed)
        return isBlockCompleted(block.id);
      
      case 'video_unskippable': {
        // PATCH-V1: Если URL пустой — bypass ТОЛЬКО для admin + preview
        const videoUrl = ((block.content as any)?.url || '').trim();
        if (!videoUrl) {
          // Admin + preview mode = bypass allowed
          // Regular user = blocked (gate closed)
          return allowBypassEmptyVideo === true;
        }
        
        const videoProgress = state?.videoProgress?.[block.id] ?? 0;
        const threshold = (block.content as any)?.threshold_percent ?? 95;
        return videoProgress >= threshold;
      }
      
      case 'video':
        return true;
      
      case 'diagnostic_table':
        const hasRows = (state?.pointA_rows?.length ?? 0) > 0;
        return hasRows && state?.pointA_completed === true;
      
      case 'sequential_form':
        return state?.pointB_completed === true;
      
      default:
        return true;
    }
  }, [state, isBlockCompleted]);

  // Current block gate status
  const currentBlock = stepBlocks[currentStepIndex];
  const isCurrentBlockGateOpen = currentBlock ? isBlockGateOpen(currentBlock, currentStepIndex) : false;

  // Scroll to block
  const scrollToBlock = useCallback((blockId: string) => {
    const el = blockRefs.current.get(blockId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // Navigate to step
  const goToStep = useCallback((index: number) => {
    if (index < 0 || index >= totalSteps) return;
    
    // Can go back freely
    if (index < currentStepIndex) {
      setCurrentStepIndex(index);
      updateState({ currentStepIndex: index });
      const block = stepBlocks[index];
      if (block) scrollToBlock(block.id);
      return;
    }
    
    // Check if current block gate is open before moving forward
    if (index > currentStepIndex && !isCurrentBlockGateOpen) {
      toast.error("Сначала завершите текущий шаг");
      return;
    }
    
    // Mark current block as completed
    if (index > currentStepIndex && currentBlock) {
      markBlockCompleted(currentBlock.id);
    }
    
    setCurrentStepIndex(index);
    updateState({ currentStepIndex: index });
    
    // Scroll to new block after state update
    setTimeout(() => {
      const block = stepBlocks[index];
      if (block) scrollToBlock(block.id);
    }, 100);
  }, [currentStepIndex, totalSteps, isCurrentBlockGateOpen, currentBlock, markBlockCompleted, updateState, stepBlocks, scrollToBlock]);

  // Handle completion of entire lesson
  const handleFinishLesson = useCallback(async () => {
    if (currentBlock) {
      markBlockCompleted(currentBlock.id);
    }
    await markLessonCompleted();
    await onComplete();
    toast.success("Урок пройден! 🎉");
  }, [currentBlock, markBlockCompleted, markLessonCompleted, onComplete]);

  // Is this the last step?
  const isLastStep = currentStepIndex === totalSteps - 1;

  // Handler for quiz_survey role selection
  const handleRoleSelected = useCallback((role: string) => {
    updateState({ role });
  }, [updateState]);

  // Handler for quiz_survey reset via canonical Edge Function
  const handleQuizSurveyReset = useCallback(async (blockId: string) => {
    console.log('[KvestLessonView] Quiz reset via Edge Function:', blockId.slice(0, 8));
    
    const result = await resetViaEdge(lesson.id, 'quiz_only', blockId);
    
    if (!result.ok) {
      console.error('[KvestLessonView] Reset failed:', result.error);
      return;
    }
    
    // Force refetch state from DB (Edge Function already cleared it)
    await refetchProgress();
    
    // Reset local step index
    setCurrentStepIndex(0);
    
    console.log('[KvestLessonView] Reset success:', result);
  }, [lesson.id, resetViaEdge, refetchProgress]);

  // Handler for role_description block completion
  const handleRoleDescriptionComplete = useCallback((blockId: string) => {
    markBlockCompleted(blockId);
    // Auto-advance to next step
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1);
    }
  }, [markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  // Handler for video progress (memoized to prevent re-renders)
  const handleVideoProgress = useCallback((blockId: string, percent: number) => {
    updateState({
      videoProgress: {
        ...(state?.videoProgress || {}),
        [blockId]: percent
      }
    });
  }, [state?.videoProgress, updateState]);

  // Handler for video completion
  const handleVideoComplete = useCallback((blockId: string) => {
    markBlockCompleted(blockId);
    // Auto-advance to next step
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1);
    }
  }, [markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  // Handler for diagnostic table (memoized)
  const handleDiagnosticTableUpdate = useCallback((rows: Record<string, unknown>[]) => {
    updateState({ pointA_rows: rows });
  }, [updateState]);

  const handleDiagnosticTableComplete = useCallback((blockId: string) => {
    updateState({ pointA_completed: true });
    markBlockCompleted(blockId);
    // Auto-advance to next step
    if (currentStepIndex < totalSteps - 1) {
      goToStep(currentStepIndex + 1);
    }
  }, [updateState, markBlockCompleted, currentStepIndex, totalSteps, goToStep]);

  // Handler for diagnostic table reset
  const handleDiagnosticTableReset = useCallback((blockId: string) => {
    console.log('[KvestLessonView] DiagnosticTable reset:', blockId.slice(0, 8));
    updateState({ 
      pointA_completed: false,
      pointA_rows: [],
      completedSteps: (state?.completedSteps || []).filter(id => id !== blockId),
      currentStepIndex: Math.max(0, currentStepIndex - 1)
    });
    toast.success("Данные сброшены — можете заполнить заново");
  }, [state?.completedSteps, currentStepIndex, updateState]);

  // Handler for sequential form (memoized)
  const handleSequentialFormUpdate = useCallback((answers: Record<string, string>) => {
    updateState({ pointB_answers: answers });
  }, [updateState]);

  const handleSequentialFormComplete = useCallback((blockId: string) => {
    updateState({ pointB_completed: true });
    markBlockCompleted(blockId);
  }, [updateState, markBlockCompleted]);

  // Handler for sequential form reset
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

  // PATCH-5: Handler for AI summary generation
  const handleSummaryGenerated = useCallback((summary: string) => {
    updateState({ pointB_summary: summary });
  }, [updateState]);

  // Memoized saved summary
  const savedSummary = useMemo(() => state?.pointB_summary || undefined, [state?.pointB_summary]);

  // Memoized props for blocks to prevent unnecessary re-renders
  const pointARows = useMemo(() => state?.pointA_rows || [], [state?.pointA_rows]);
  const pointBAnswers = useMemo(() => state?.pointB_answers || {}, [state?.pointB_answers]);
  const userRole = useMemo(() => state?.role || null, [state?.role]);

  // Render block with kvest-specific props
  const renderBlockWithProps = useCallback((block: LessonBlock, isCompleted: boolean, isCurrent: boolean) => {
    const blockType = block.block_type;
    const blockId = block.id;
    
    // Common props for LessonBlockRenderer
    const commonProps = {
      blocks: [block],
      lessonId: lesson.id,
    };

    // isReadOnly: завершённые блоки, но НЕ текущие — read-only режим с данными
    const isReadOnly = isCompleted && !isCurrent;

    // Render with specific props based on block type
    // ВАЖНО: kvestProps передаются ВСЕГДА, даже для read-only блоков!
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
                role: userRole,  // ← КРИТИЧЕСКИ: роль передаётся ВСЕГДА
                onComplete: isReadOnly ? undefined : () => handleRoleDescriptionComplete(blockId),
                isCompleted: isCompleted,
              }}
            />
          </div>
        );
      
      case 'video_unskippable': {
        const videoProgress = state?.videoProgress?.[blockId] ?? 0;
        // PATCH-2: Use unique key based on isCompleted to force full remount
        // This isolates Kinescope's DOM from React reconciliation
        const stableKey = `${blockId}-${isCompleted ? 'completed' : 'active'}`;
        return (
          <div key={stableKey} className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                watchedPercent: videoProgress,
                onProgress: isReadOnly ? undefined : (percent: number) => handleVideoProgress(blockId, percent),
                onComplete: isReadOnly ? undefined : () => handleVideoComplete(blockId),
                isCompleted: isCompleted,
                allowBypassEmptyVideo: allowBypassEmptyVideo,
              }}
            />
          </div>
        );
      }
      
      case 'diagnostic_table':
        return (
          <div className={isReadOnly ? "opacity-80" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                rows: pointARows,  // ← КРИТИЧЕСКИ: данные передаются ВСЕГДА
                onRowsChange: isReadOnly ? undefined : handleDiagnosticTableUpdate,
                onComplete: isReadOnly ? undefined : () => handleDiagnosticTableComplete(blockId),
                isCompleted: state?.pointA_completed || false,
                onReset: (state?.pointA_completed) ? () => handleDiagnosticTableReset(blockId) : undefined,
              }}
            />
          </div>
        );
      
      case 'sequential_form':
        return (
          <div className={isReadOnly ? "opacity-80" : ""}>
            <LessonBlockRenderer 
              {...commonProps}
              kvestProps={{
                answers: pointBAnswers,  // ← КРИТИЧЕСКИ: ответы передаются ВСЕГДА
                onAnswersChange: isReadOnly ? undefined : handleSequentialFormUpdate,
                onComplete: isReadOnly ? undefined : () => handleSequentialFormComplete(blockId),
                isCompleted: state?.pointB_completed || false,
                savedSummary: savedSummary,  // PATCH-5: Pass saved summary
                onSummaryGenerated: isReadOnly ? undefined : handleSummaryGenerated,  // PATCH-5
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
    pointBAnswers,
    savedSummary,
    handleRoleSelected,
    handleQuizSurveyReset,
    handleRoleDescriptionComplete,
    handleVideoProgress,
    handleVideoComplete,
    handleDiagnosticTableUpdate,
    handleDiagnosticTableComplete,
    handleDiagnosticTableReset,
    handleSequentialFormUpdate,
    handleSequentialFormComplete,
    handleSequentialFormReset,
    handleSummaryGenerated,
  ]);

  // Get gate explanation for current block
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
      {/* Progress Header - Sticky with Glass Effect */}
      <div 
        className="sticky top-0 z-10 rounded-2xl backdrop-blur-2xl border border-primary/30 shadow-xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))",
          boxShadow: "0 12px 40px hsl(var(--primary) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
        }}
      >
        {/* Decorative orb */}
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
                  onClick={() => isAccessible && goToStep(idx)}
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

      {/* PATCH-2: Cumulative Block Rendering - All blocks up to currentStepIndex are visible */}
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
              {/* Block header with step indicator */}
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
                  {block.block_type === 'diagnostic_table' && <span className="text-sm text-muted-foreground">Точка А</span>}
                  {block.block_type === 'sequential_form' && <span className="text-sm text-muted-foreground">Точка Б</span>}
                </div>
                {isCompleted && (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                )}
              </div>
              
              <CardContent className="py-6">
                {renderBlockWithProps(block, isCompleted, isCurrent)}
              </CardContent>

              {/* Gate explanation for current incomplete block */}
              {isCurrent && !gateOpen && (
                <div className="px-4 py-3 border-t border-destructive/20 bg-destructive/10 text-center text-sm text-destructive backdrop-blur-sm">
                  {getGateExplanation(block)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Next step indicator when current is complete */}
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

      {/* Final step: Finish lesson */}
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

      {/* Navigation bar at bottom */}
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
