import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, CheckCircle2, Lock } from "lucide-react";
import { LessonBlock, BlockType } from "@/hooks/useLessonBlocks";
import { TrainingLesson } from "@/hooks/useTrainingLessons";
import { useLessonProgressState, LessonProgressStateData } from "@/hooks/useLessonProgressState";
import { LessonBlockRenderer } from "./LessonBlockRenderer";
import { toast } from "sonner";

// Block types that count as "steps" in kvest mode
const STEP_BLOCK_TYPES: BlockType[] = [
  'quiz_survey',
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

  const currentBlock = stepBlocks[currentStepIndex];
  const totalSteps = stepBlocks.length;
  const progressPercent = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  // Check if current block is completed (gate rule)
  const isCurrentBlockGateOpen = useMemo(() => {
    if (!currentBlock) return false;
    
    const blockType = currentBlock.block_type;
    
    // Check if block is in completedSteps
    if (isBlockCompleted(currentBlock.id)) return true;
    
    // Specific gate rules per block type
    switch (blockType) {
      case 'quiz_survey':
        // Gate opens when role is selected and results shown
        return !!state?.role;
      
      case 'video_unskippable':
        // Gate opens when video threshold reached
        const videoProgress = state?.videoProgress?.[currentBlock.id] ?? 0;
        const threshold = (currentBlock.content as any)?.threshold_percent ?? 95;
        return videoProgress >= threshold;
      
      case 'video':
        // Regular video - always open (no gate)
        return true;
      
      case 'diagnostic_table':
        // Gate opens when table has rows and is marked complete
        const hasRows = (state?.pointA_rows?.length ?? 0) > 0;
        return hasRows && state?.pointA_completed === true;
      
      case 'sequential_form':
        // Gate opens when all steps filled and marked complete
        return state?.pointB_completed === true;
      
      default:
        // Text, callout, etc - always open
        return true;
    }
  }, [currentBlock, state, isBlockCompleted]);

  // Navigate to step
  const goToStep = useCallback((index: number) => {
    if (index < 0 || index >= totalSteps) return;
    
    // Can go back freely, but can't skip forward
    if (index > currentStepIndex && !isCurrentBlockGateOpen) {
      toast.error("Сначала завершите текущий шаг");
      return;
    }
    
    // If going forward, mark current block as completed
    if (index > currentStepIndex && currentBlock) {
      markBlockCompleted(currentBlock.id);
    }
    
    setCurrentStepIndex(index);
    updateState({ currentStepIndex: index });
  }, [currentStepIndex, totalSteps, isCurrentBlockGateOpen, currentBlock, markBlockCompleted, updateState]);

  // Handle completion of entire lesson
  const handleFinishLesson = async () => {
    if (currentBlock) {
      markBlockCompleted(currentBlock.id);
    }
    await markLessonCompleted();
    await onComplete();
    toast.success("Урок пройден! 🎉");
  };

  // Is this the last step?
  const isLastStep = currentStepIndex === totalSteps - 1;

  // All steps completed?
  const allStepsCompleted = stepBlocks.every(b => isBlockCompleted(b.id));

  // Handler for quiz_survey role selection
  const handleRoleSelected = useCallback((role: string) => {
    updateState({ role });
  }, [updateState]);

  // Handler for video progress
  const handleVideoProgress = useCallback((blockId: string, percent: number) => {
    updateState({
      videoProgress: {
        ...(state?.videoProgress || {}),
        [blockId]: percent
      }
    });
  }, [state?.videoProgress, updateState]);

  // Handler for diagnostic table
  const handleDiagnosticTableUpdate = useCallback((rows: Record<string, unknown>[]) => {
    updateState({ pointA_rows: rows });
  }, [updateState]);

  const handleDiagnosticTableComplete = useCallback(() => {
    updateState({ pointA_completed: true });
    markBlockCompleted(currentBlock?.id || '');
  }, [updateState, markBlockCompleted, currentBlock]);

  // Handler for sequential form
  const handleSequentialFormUpdate = useCallback((answers: Record<string, string>) => {
    updateState({ pointB_answers: answers });
  }, [updateState]);

  const handleSequentialFormComplete = useCallback(() => {
    updateState({ pointB_completed: true });
    markBlockCompleted(currentBlock?.id || '');
  }, [updateState, markBlockCompleted, currentBlock]);

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
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
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
          <div className="flex justify-between mt-2">
            {stepBlocks.map((block, idx) => (
              <button
                key={block.id}
                onClick={() => idx <= currentStepIndex && goToStep(idx)}
                disabled={idx > currentStepIndex && !isCurrentBlockGateOpen}
                className={`
                  w-6 h-6 rounded-full text-xs font-medium transition-all
                  ${idx < currentStepIndex || isBlockCompleted(block.id)
                    ? 'bg-primary text-primary-foreground' 
                    : idx === currentStepIndex
                      ? 'bg-primary/80 text-primary-foreground ring-2 ring-primary ring-offset-2'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }
                `}
              >
                {isBlockCompleted(block.id) ? (
                  <CheckCircle2 className="h-3 w-3 mx-auto" />
                ) : idx > currentStepIndex ? (
                  <Lock className="h-3 w-3 mx-auto" />
                ) : (
                  idx + 1
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Current Block Content */}
      <Card>
        <CardContent className="py-6">
          {currentBlock && (
            <LessonBlockRenderer 
              blocks={[currentBlock]} 
              lessonId={lesson.id}
              // Pass kvest-specific props via context if needed
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          onClick={() => goToStep(currentStepIndex - 1)}
          disabled={currentStepIndex === 0}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Назад
        </Button>

        <div className="flex gap-2">
          {!isLastStep ? (
            <Button
              onClick={() => goToStep(currentStepIndex + 1)}
              disabled={!isCurrentBlockGateOpen}
            >
              Дальше
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleFinishLesson}
              disabled={!isCurrentBlockGateOpen}
              variant="default"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Завершить урок
            </Button>
          )}
        </div>
      </div>

      {/* Gate explanation */}
      {!isCurrentBlockGateOpen && (
        <Card className="border-border bg-muted/50">
          <CardContent className="py-3 text-center text-sm text-muted-foreground">
            {currentBlock?.block_type === 'quiz_survey' && "Выберите ответ и получите результат, чтобы продолжить"}
            {currentBlock?.block_type === 'video_unskippable' && "Досмотрите видео до конца, чтобы продолжить"}
            {currentBlock?.block_type === 'diagnostic_table' && "Добавьте минимум одну строку и нажмите кнопку завершения"}
            {currentBlock?.block_type === 'sequential_form' && "Заполните все шаги и нажмите кнопку завершения"}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
