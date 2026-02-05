import { LessonBlock } from "@/hooks/useLessonBlocks";
import { useUserProgress } from "@/hooks/useUserProgress";
import { HeadingBlock } from "@/components/admin/lesson-editor/blocks/HeadingBlock";
import { TextBlock } from "@/components/admin/lesson-editor/blocks/TextBlock";
import { VideoBlock } from "@/components/admin/lesson-editor/blocks/VideoBlock";
import { AudioBlock } from "@/components/admin/lesson-editor/blocks/AudioBlock";
import { ImageBlock } from "@/components/admin/lesson-editor/blocks/ImageBlock";
import { FileBlock } from "@/components/admin/lesson-editor/blocks/FileBlock";
import { ButtonBlock } from "@/components/admin/lesson-editor/blocks/ButtonBlock";
import { EmbedBlock } from "@/components/admin/lesson-editor/blocks/EmbedBlock";
import { DividerBlock } from "@/components/admin/lesson-editor/blocks/DividerBlock";
import { AccordionBlock } from "@/components/admin/lesson-editor/blocks/AccordionBlock";
import { TabsBlock } from "@/components/admin/lesson-editor/blocks/TabsBlock";
import { SpoilerBlock } from "@/components/admin/lesson-editor/blocks/SpoilerBlock";
import { CalloutBlock } from "@/components/admin/lesson-editor/blocks/CalloutBlock";
import { TimelineBlock } from "@/components/admin/lesson-editor/blocks/TimelineBlock";
import { StepsBlock } from "@/components/admin/lesson-editor/blocks/StepsBlock";
import { QuoteBlock } from "@/components/admin/lesson-editor/blocks/QuoteBlock";
import { GalleryBlock } from "@/components/admin/lesson-editor/blocks/GalleryBlock";
import { QuizSingleBlock } from "@/components/admin/lesson-editor/blocks/QuizSingleBlock";
import { QuizMultipleBlock } from "@/components/admin/lesson-editor/blocks/QuizMultipleBlock";
import { QuizTrueFalseBlock } from "@/components/admin/lesson-editor/blocks/QuizTrueFalseBlock";
import { QuizFillBlankBlock } from "@/components/admin/lesson-editor/blocks/QuizFillBlankBlock";
import { QuizMatchingBlock } from "@/components/admin/lesson-editor/blocks/QuizMatchingBlock";
import { QuizSequenceBlock } from "@/components/admin/lesson-editor/blocks/QuizSequenceBlock";
import { QuizHotspotBlock } from "@/components/admin/lesson-editor/blocks/QuizHotspotBlock";
import { QuizSurveyBlock } from "@/components/admin/lesson-editor/blocks/QuizSurveyBlock";
import { VideoUnskippableBlock } from "@/components/admin/lesson-editor/blocks/VideoUnskippableBlock";
import { DiagnosticTableBlock } from "@/components/admin/lesson-editor/blocks/DiagnosticTableBlock";
import { SequentialFormBlock } from "@/components/admin/lesson-editor/blocks/SequentialFormBlock";
import { RoleDescriptionBlock } from "@/components/admin/lesson-editor/blocks/RoleDescriptionBlock";

// Kvest-specific props passed from KvestLessonView
export interface KvestBlockProps {
  // Role description
  role?: string | null;
  onRoleSelected?: (role: string) => void;
  
  // Video
  watchedPercent?: number;
  onProgress?: (percent: number) => void;
  
  // Diagnostic table
  rows?: Record<string, unknown>[];
  onRowsChange?: (rows: Record<string, unknown>[]) => void;
  
  // Sequential form
  answers?: Record<string, string>;
  onAnswersChange?: (answers: Record<string, string>) => void;
  savedSummary?: string;                    // PATCH-5: Pre-saved AI summary
  onSummaryGenerated?: (summary: string) => void; // PATCH-5: Callback to save summary
  
  // Common
  onComplete?: () => void;
  isCompleted?: boolean;
  userRole?: string | null;
  
  // PATCH-V1/V2: Admin bypass for empty video URL
  allowBypassEmptyVideo?: boolean;
}

export interface LessonBlockRendererProps {
  blocks: LessonBlock[];
  lessonId?: string;
  /** Active timecode in seconds for video seeking (optional) */
  activeTimecode?: number | null;
  /** Nonce to force autoplay when timecode changes from user action */
  autoplayNonce?: number;
  /** Callback when seek was successfully applied by video player */
  onSeekApplied?: (seconds: number, nonce: number) => void;
  /** Kvest-specific props for interactive blocks */
  kvestProps?: KvestBlockProps;
}

export function LessonBlockRenderer({ 
  blocks, 
  lessonId, 
  activeTimecode, 
  autoplayNonce, 
  onSeekApplied,
  kvestProps 
}: LessonBlockRendererProps) {
  const { progress, saveBlockResponse, resetBlockProgress } = useUserProgress(lessonId || '');

  if (!blocks || blocks.length === 0) {
    return null;
  }

  const handleQuizSubmit = async (
    blockId: string, 
    answer: Record<string, unknown>, 
    isCorrect: boolean, 
    score: number, 
    maxScore: number
  ) => {
    await saveBlockResponse(blockId, answer, isCorrect, score, maxScore);
    // PATCH-A: For quiz_survey in kvest mode, extract role from dominantCategories
    if (kvestProps?.onRoleSelected) {
      // dominantCategories — массив категорий, берём первую
      const categories = answer?.dominantCategories as string[] | undefined;
      const primaryCategory = categories?.[0];
      
      if (primaryCategory) {
        const categoryToRole: Record<string, string> = {
          'A': 'executor',
          'А': 'executor',  // Cyrillic
          'B': 'freelancer', 
          'Б': 'freelancer', // Cyrillic
          'C': 'entrepreneur',
          'В': 'entrepreneur', // Cyrillic
        };
        const role = categoryToRole[primaryCategory];
        if (role) {
          kvestProps.onRoleSelected(role);
        }
      }
    }
  };

  const handleQuizReset = async (blockId: string) => {
    await resetBlockProgress(blockId);
  };

  const renderBlock = (block: LessonBlock) => {
    const noop = () => {};
    const blockProgress = progress?.blockProgress[block.id];
    const savedResponse = blockProgress?.response as any;
    
    // Sprint A+B: Correct isSubmitted logic
    // hasResponse = response exists and has data (could be draft)
    // isSubmitted = response.is_submitted === true OR response.submitted_at exists OR completed_at exists
    const hasResponse = savedResponse != null && Object.keys(savedResponse).length > 0;
    const isSubmitted = 
      savedResponse?.is_submitted === true || 
      savedResponse?.submitted_at != null || 
      !!blockProgress?.completed_at;
    
    const attempts = blockProgress?.attempts || 0;
    
    switch (block.block_type) {
      case 'heading':
        return <HeadingBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'text':
        return <TextBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'video':
        return <VideoBlock content={block.content as any} onChange={noop} isEditing={false} activeTimecode={activeTimecode} autoplayNonce={autoplayNonce} onSeekApplied={onSeekApplied} />;
      case 'audio':
        return <AudioBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'image':
        return <ImageBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'gallery':
        return <GalleryBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'file':
        return <FileBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'button':
        return <ButtonBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'embed':
        return <EmbedBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'divider':
        return <DividerBlock isEditing={false} />;
      case 'accordion':
        return <AccordionBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'tabs':
        return <TabsBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'spoiler':
        return <SpoilerBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'callout':
        return <CalloutBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'quote':
        return <QuoteBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'timeline':
        return <TimelineBlock content={block.content as any} onChange={noop} isEditing={false} />;
      case 'steps':
        return <StepsBlock content={block.content as any} onChange={noop} isEditing={false} />;
      
      // Quiz blocks with progress integration
      case 'quiz_single':
        return (
          <QuizSingleBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            userAnswer={savedResponse?.answer}
            isSubmitted={isSubmitted}
            onSubmit={(answerId) => handleQuizSubmit(
              block.id, 
              { answer: answerId, is_submitted: true, submitted_at: new Date().toISOString() }, 
              answerId === (block.content as any).options?.find((o: any) => o.isCorrect)?.id,
              answerId === (block.content as any).options?.find((o: any) => o.isCorrect)?.id ? ((block.content as any).points || 1) : 0,
              (block.content as any).points || 1
            )}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      case 'quiz_multiple':
        return (
          <QuizMultipleBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            userAnswer={savedResponse?.answer}
            isSubmitted={isSubmitted}
            onSubmit={(answers) => {
              const content = block.content as any;
              const correctIds = content.options?.filter((o: any) => o.isCorrect).map((o: any) => o.id) || [];
              const isCorrect = JSON.stringify([...answers].sort()) === JSON.stringify([...correctIds].sort());
              handleQuizSubmit(
                block.id, 
                { answer: answers, is_submitted: true, submitted_at: new Date().toISOString() }, 
                isCorrect, 
                isCorrect ? (content.points || 1) : 0, 
                content.points || 1
              );
            }}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      case 'quiz_true_false':
        return (
          <QuizTrueFalseBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            userAnswer={savedResponse?.answer}
            isSubmitted={isSubmitted}
            onSubmit={(answer) => {
              const content = block.content as any;
              const isCorrect = answer === content.correctAnswer;
              handleQuizSubmit(
                block.id, 
                { answer, is_submitted: true, submitted_at: new Date().toISOString() }, 
                isCorrect, 
                isCorrect ? (content.points || 1) : 0, 
                content.points || 1
              );
            }}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      
      // Sprint A+B: Updated quiz_fill_blank with unified props
      case 'quiz_fill_blank':
        return (
          <QuizFillBlankBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            blockId={block.id}
            savedAnswer={savedResponse}
            isSubmitted={isSubmitted}
            attempts={attempts}
            onSubmit={(answer, isCorrect, score, maxScore) => 
              handleQuizSubmit(block.id, answer as unknown as Record<string, unknown>, isCorrect, score, maxScore)
            }
            onReset={() => handleQuizReset(block.id)}
          />
        );
      case 'quiz_matching':
        return (
          <QuizMatchingBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            blockId={block.id}
            savedAnswer={savedResponse}
            isSubmitted={isSubmitted}
            attempts={attempts}
            onSubmit={(answer, isCorrect, score, maxScore) => handleQuizSubmit(block.id, answer as unknown as Record<string, unknown>, isCorrect, score, maxScore)}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      case 'quiz_sequence':
        return (
          <QuizSequenceBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            blockId={block.id}
            savedAnswer={savedResponse}
            isSubmitted={isSubmitted}
            attempts={attempts}
            onSubmit={(answer, isCorrect, score, maxScore) => handleQuizSubmit(block.id, answer as unknown as Record<string, unknown>, isCorrect, score, maxScore)}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      case 'quiz_hotspot':
        return (
          <QuizHotspotBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            blockId={block.id}
            savedAnswer={savedResponse}
            isSubmitted={isSubmitted}
            attempts={attempts}
            onSubmit={(answer, isCorrect, score, maxScore) => handleQuizSubmit(block.id, answer as unknown as Record<string, unknown>, isCorrect, score, maxScore)}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      case 'quiz_survey':
        return (
          <QuizSurveyBlock 
            content={block.content as any} 
            onChange={noop} 
            isEditing={false}
            blockId={block.id}
            savedAnswer={savedResponse}
            isSubmitted={isSubmitted || kvestProps?.isCompleted}
            onSubmit={(answer, isCorrect, score, maxScore) => handleQuizSubmit(block.id, answer as unknown as Record<string, unknown>, isCorrect, score, maxScore)}
            onReset={() => handleQuizReset(block.id)}
          />
        );
      
      // Kvest blocks with kvestProps integration
      case 'video_unskippable':
        return (
          <VideoUnskippableBlock 
            content={block.content as any} 
            onChange={() => {}} 
            isEditing={false}
            watchedPercent={kvestProps?.watchedPercent}
            onProgress={kvestProps?.onProgress}
            onComplete={kvestProps?.onComplete}
            isCompleted={kvestProps?.isCompleted}
            allowBypassEmptyVideo={kvestProps?.allowBypassEmptyVideo}
          />
        );
      case 'diagnostic_table':
        return (
          <DiagnosticTableBlock 
            content={block.content as any} 
            onChange={() => {}} 
            isEditing={false}
            rows={kvestProps?.rows}
            onRowsChange={kvestProps?.onRowsChange}
            onComplete={kvestProps?.onComplete}
            isCompleted={kvestProps?.isCompleted}
          />
        );
      case 'sequential_form':
        return (
          <SequentialFormBlock 
            content={block.content as any} 
            onChange={() => {}} 
            isEditing={false}
            answers={kvestProps?.answers}
            onAnswersChange={kvestProps?.onAnswersChange}
            onComplete={kvestProps?.onComplete}
            isCompleted={kvestProps?.isCompleted}
            savedSummary={kvestProps?.savedSummary}
            onSummaryGenerated={kvestProps?.onSummaryGenerated}
          />
        );
      case 'role_description':
        return (
          <RoleDescriptionBlock 
            content={block.content as any} 
            onChange={() => {}} 
            isEditing={false}
            userRole={kvestProps?.role || undefined}
            onComplete={kvestProps?.onComplete}
            isCompleted={kvestProps?.isCompleted}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {blocks.map((block) => (
        <div 
          key={block.id}
          data-testid="lesson-block"
          data-block-type={block.block_type}
        >
          {renderBlock(block)}
        </div>
      ))}
    </div>
  );
}
