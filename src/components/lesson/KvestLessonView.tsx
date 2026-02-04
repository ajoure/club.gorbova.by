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
}

export function KvestLessonView({ lesson, blocks, moduleSlug, onComplete }: KvestLessonViewProps) {
  const navigate = useNavigate();
  const { state, updateState, markBlockCompleted, isBlockCompleted, markLessonCompleted } = useLessonProgressState(lesson.id);
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
      
      case 'video_unskippable':
        // PATCH: Если URL пустой — gate открыт (для dev/preview режима)
        const videoUrl = (block.content as any)?.url;
        if (!videoUrl) return true;
        
        const videoProgress = state?.videoProgress?.[block.id] ?? 0;
        const threshold = (block.content as any)?.threshold_percent ?? 95;
        return videoProgress >= threshold;
      
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

  // Handler for sequential form (memoized)
  const handleSequentialFormUpdate = useCallback((answers: Record<string, string>) => {
    updateState({ pointB_answers: answers });
  }, [updateState]);

  const handleSequentialFormComplete = useCallback((blockId: string) => {
    updateState({ pointB_completed: true });
    markBlockCompleted(blockId);
  }, [updateState, markBlockCompleted]);

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

    // For completed blocks, render as read-only
    if (isCompleted && !isCurrent) {
      return (
        <div className="opacity-80 pointer-events-none">
          <LessonBlockRenderer {...commonProps} />
        </div>
      );
    }

    // Render with specific props based on block type
    switch (blockType) {
      case 'quiz_survey':
        return (
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              onRoleSelected: handleRoleSelected,
              isCompleted: isCompleted,
            }}
          />
        );
      
      case 'role_description':
        return (
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              role: userRole,
              onComplete: () => handleRoleDescriptionComplete(blockId),
              isCompleted: isCompleted,
            }}
          />
        );
      
      case 'video_unskippable':
        const videoProgress = state?.videoProgress?.[blockId] ?? 0;
        return (
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              watchedPercent: videoProgress,
              onProgress: (percent: number) => handleVideoProgress(blockId, percent),
              onComplete: () => handleVideoComplete(blockId),
              isCompleted: isCompleted,
            }}
          />
        );
      
      case 'diagnostic_table':
        return (
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              rows: pointARows,
              onRowsChange: handleDiagnosticTableUpdate,
              onComplete: () => handleDiagnosticTableComplete(blockId),
              isCompleted: state?.pointA_completed || false,
            }}
          />
        );
      
      case 'sequential_form':
        return (
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              answers: pointBAnswers,
              onAnswersChange: handleSequentialFormUpdate,
              onComplete: () => handleSequentialFormComplete(blockId),
              isCompleted: state?.pointB_completed || false,
            }}
          />
        );
      
      default:
        return <LessonBlockRenderer {...commonProps} />;
    }
  }, [
    lesson.id, 
    state, 
    userRole,
    pointARows,
    pointBAnswers,
    handleRoleSelected,
    handleRoleDescriptionComplete,
    handleVideoProgress,
    handleVideoComplete,
    handleDiagnosticTableUpdate,
    handleDiagnosticTableComplete,
    handleSequentialFormUpdate,
    handleSequentialFormComplete,
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
      {/* Progress Header - Sticky */}
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20 sticky top-0 z-10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{lesson.title}</CardTitle>
            <Badge variant="outline" className="text-sm">
              Шаг {currentStepIndex + 1} из {totalSteps}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between mt-2 flex-wrap gap-1">
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
                    "w-7 h-7 rounded-full text-xs font-medium transition-all flex items-center justify-center",
                    completed
                      ? 'bg-primary text-primary-foreground' 
                      : isCurrent
                        ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2'
                        : isAccessible
                          ? 'bg-primary/60 text-primary-foreground hover:bg-primary/80'
                          : 'bg-muted text-muted-foreground cursor-not-allowed'
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
        </CardContent>
      </Card>

      {/* PATCH-2: Cumulative Block Rendering - All blocks up to currentStepIndex are visible */}
      <div className="space-y-4">
        {stepBlocks.map((block, idx) => {
          const isVisible = idx <= currentStepIndex;
          const isCompleted = isBlockCompleted(block.id);
          const isCurrent = idx === currentStepIndex;
          const gateOpen = isBlockGateOpen(block, idx);
          
          if (!isVisible) return null;
          
          return (
            <Card 
              key={block.id}
              ref={(el) => {
                if (el) blockRefs.current.set(block.id, el);
              }}
              className={cn(
                "transition-all duration-300",
                isCompleted && !isCurrent && "border-primary/30 bg-primary/5",
                isCurrent && "ring-2 ring-primary/50 shadow-lg"
              )}
            >
              {/* Block header with step indicator */}
              <div className={cn(
                "px-4 py-2 border-b flex items-center justify-between",
                isCompleted ? "bg-primary/10" : isCurrent ? "bg-primary/10" : "bg-muted/30"
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
                <div className="px-4 py-3 border-t bg-destructive/10 text-center text-sm text-destructive">
                  {getGateExplanation(block)}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Next step indicator when current is complete */}
      {isCurrentBlockGateOpen && !isLastStep && (
        <div className="flex justify-center">
          <Button
            onClick={() => goToStep(currentStepIndex + 1)}
            className="gap-2"
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
            className="gap-2"
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
