import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { 
  SortableContext, 
  sortableKeyboardCoordinates, 
  useSortable, 
  verticalListSortingStrategy 
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2, Check, X, RotateCcw, GripVertical, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MatchingPair {
  id: string;
  left: string;
  right: string;
  rightId: string; // Sprint A+B: unique id for right element
}

export interface QuizMatchingContent {
  question: string;
  pairs: MatchingPair[];
  explanation?: string;
  points?: number;
}

// Sprint A+B: Unified answer interface (meta stored in DB columns, not in response)
interface MatchingAnswer {
  matches: Record<string, string>; // pairId -> rightId
  rightOrder: string[]; // order of rightIds
  is_submitted?: boolean;
  submitted_at?: string;
}

interface QuizMatchingBlockProps {
  content: QuizMatchingContent;
  onChange: (content: QuizMatchingContent) => void;
  isEditing?: boolean;
  blockId?: string;
  savedAnswer?: MatchingAnswer;
  isSubmitted?: boolean;
  attempts?: number;
  onSubmit?: (answer: MatchingAnswer, isCorrect: boolean, score: number, maxScore: number) => void;
  onReset?: () => void;
}

interface DraggableRightItemProps {
  id: string;
  text: string;
  isMatched?: boolean;
  isCorrect?: boolean;
  isSubmitted?: boolean;
}

function DraggableRightItem({ id, text, isMatched, isCorrect, isSubmitted }: DraggableRightItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors",
        "bg-card hover:bg-muted/50",
        isMatched && !isSubmitted && "border-primary bg-primary/5",
        isSubmitted && isCorrect && "border-green-500 bg-green-500/10",
        isSubmitted && !isCorrect && isMatched && "border-red-500 bg-red-500/10"
      )}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="flex-1">{text}</span>
      </div>
    </div>
  );
}

export function QuizMatchingBlock({
  content,
  onChange,
  isEditing = true,
  blockId,
  savedAnswer,
  isSubmitted,
  attempts,
  onSubmit,
  onReset,
}: QuizMatchingBlockProps) {
  const rawPairs = content.pairs || [];
  
  // Sprint A+B: Migrate pairs to ensure rightId exists (for editor)
  const pairs: MatchingPair[] = rawPairs.map(p => ({
    ...p,
    rightId: p.rightId || `legacy-${p.id}` // fallback for old data
  }));

  const [matches, setMatches] = useState<Record<string, string>>({});
  const [shuffledRightIds, setShuffledRightIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  
  // Sprint A+B: Guard to prevent re-initialization
  const initializedRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sprint A+B: Single initialization effect with priority for savedAnswer
  useEffect(() => {
    if (isEditing || pairs.length === 0 || initializedRef.current) return;

    // Priority: restore from savedAnswer if available
    if (savedAnswer?.rightOrder && savedAnswer.rightOrder.length > 0) {
      setShuffledRightIds(savedAnswer.rightOrder);
      if (savedAnswer.matches) {
        setMatches(savedAnswer.matches);
      }
    } else {
      // Shuffle only if no saved answer
      const rightIds = pairs.map(p => p.rightId);
      const shuffled = [...rightIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setShuffledRightIds(shuffled);
    }
    
    initializedRef.current = true;
  }, [isEditing, pairs.length, savedAnswer]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const oldIndex = shuffledRightIds.indexOf(active.id as string);
      const newIndex = shuffledRightIds.indexOf(over.id as string);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = [...shuffledRightIds];
        newOrder.splice(oldIndex, 1);
        newOrder.splice(newIndex, 0, active.id as string);
        setShuffledRightIds(newOrder);
        
        // Update matches based on new positions
        const newMatches: Record<string, string> = {};
        pairs.forEach((pair, index) => {
          if (newOrder[index]) {
            newMatches[pair.id] = newOrder[index];
          }
        });
        setMatches(newMatches);
      }
    }
  };

  // Sprint A+B: Fixed correctness check using rightId
  const checkCorrectness = (): { isCorrect: boolean; correctCount: number } => {
    let correctCount = 0;
    pairs.forEach((pair, index) => {
      // Correct if the rightId at this position matches the pair's rightId
      if (shuffledRightIds[index] === pair.rightId) {
        correctCount++;
      }
    });
    return { 
      isCorrect: correctCount === pairs.length, 
      correctCount 
    };
  };

  // Sprint A+B: Updated submit with unified response format
  const handleSubmit = () => {
    if (!onSubmit) return;
    
    const currentMatches: Record<string, string> = {};
    pairs.forEach((pair, index) => {
      currentMatches[pair.id] = shuffledRightIds[index];
    });
    
    const { isCorrect, correctCount } = checkCorrectness();
    const maxScore = content.points || pairs.length;
    const score = (maxScore === pairs.length) 
      ? correctCount 
      : Math.floor((correctCount / pairs.length) * maxScore);
    
    const answer: MatchingAnswer = {
      matches: currentMatches,
      rightOrder: shuffledRightIds,
      is_submitted: true,
      submitted_at: new Date().toISOString(),
    };
    
    onSubmit(answer, isCorrect, score, maxScore);
  };

  const handleReset = () => {
    // Reshuffle
    const rightIds = pairs.map(p => p.rightId);
    const shuffled = [...rightIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setShuffledRightIds(shuffled);
    setMatches({});
    initializedRef.current = true; // Keep guard active
    onReset?.();
  };

  // Editor functions
  const addPair = () => {
    const newPair: MatchingPair = {
      id: crypto.randomUUID(),
      rightId: crypto.randomUUID(), // Sprint A+B: Generate rightId on creation
      left: "",
      right: "",
    };
    onChange({ ...content, pairs: [...pairs, newPair] });
  };

  const updatePair = (id: string, field: 'left' | 'right', value: string) => {
    onChange({
      ...content,
      pairs: pairs.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    });
  };

  const removePair = (id: string) => {
    onChange({ ...content, pairs: pairs.filter((p) => p.id !== id) });
  };

  // Sprint A+B: Migrate rightId when saving in editor
  const handleEditorSave = () => {
    const migratedPairs = pairs.map(p => ({
      ...p,
      rightId: p.rightId || crypto.randomUUID()
    }));
    onChange({ ...content, pairs: migratedPairs });
  };

  // Student view
  if (!isEditing) {
    const { correctCount } = isSubmitted ? checkCorrectness() : { correctCount: 0 };
    const allCorrect = isSubmitted && correctCount === pairs.length;

    return (
      <div data-testid="quiz-matching" className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="font-medium text-lg">{content.question || "Установите соответствие"}</div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-start">
            {/* Left column - static */}
            <div className="space-y-2">
              {pairs.map((pair, index) => {
                const isCorrectMatch = isSubmitted && shuffledRightIds[index] === pair.rightId;
                return (
                  <div
                    key={`left-${pair.id}`}
                    className={cn(
                      "p-3 rounded-lg border bg-muted/50",
                      isSubmitted && isCorrectMatch && "border-green-500",
                      isSubmitted && !isCorrectMatch && "border-red-500"
                    )}
                  >
                    {pair.left}
                  </div>
                );
              })}
            </div>

            {/* Arrows */}
            <div className="space-y-2 pt-1">
              {pairs.map((pair) => (
                <div key={`arrow-${pair.id}`} className="h-[46px] flex items-center justify-center">
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </div>
              ))}
            </div>

            {/* Right column - draggable */}
            <SortableContext items={shuffledRightIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {shuffledRightIds.map((rightId, index) => {
                  const pair = pairs.find(p => p.rightId === rightId);
                  const originalPair = pairs[index];
                  const isCorrectMatch = isSubmitted && rightId === originalPair?.rightId;
                  
                  return pair ? (
                    <DraggableRightItem
                      key={rightId}
                      id={rightId}
                      text={pair.right}
                      isMatched={!!matches[originalPair?.id]}
                      isCorrect={isCorrectMatch}
                      isSubmitted={isSubmitted}
                    />
                  ) : null;
                })}
              </div>
            </SortableContext>
          </div>
        </DndContext>

        {!isSubmitted ? (
          <Button data-testid="quiz-submit" onClick={handleSubmit} className="w-full">
            Проверить ответ
          </Button>
        ) : (
          <div className="space-y-3">
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              allCorrect ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"
            )}>
              {allCorrect ? (
                <>
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Все правильно!</span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5" />
                  <span className="font-medium">
                    Правильно {correctCount} из {pairs.length}
                  </span>
                </>
              )}
            </div>

            {content.explanation && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <span className="font-medium">Пояснение: </span>
                {content.explanation}
              </div>
            )}

            {onReset && (
              <Button variant="outline" onClick={handleReset} className="w-full">
                <RotateCcw className="h-4 w-4 mr-2" />
                Попробовать снова
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Editor view
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Вопрос / Инструкция</Label>
        <Textarea
          value={content.question || ""}
          onChange={(e) => onChange({ ...content, question: e.target.value })}
          placeholder="Установите соответствие между элементами..."
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>Пары соответствий</Label>
        <div className="space-y-2">
          {pairs.map((pair, index) => (
            <div key={pair.id} className="flex items-center gap-2">
              <Input
                value={pair.left}
                onChange={(e) => updatePair(pair.id, "left", e.target.value)}
                placeholder={`Левый элемент ${index + 1}...`}
                className="flex-1"
              />
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                value={pair.right}
                onChange={(e) => updatePair(pair.id, "right", e.target.value)}
                placeholder={`Правый элемент ${index + 1}...`}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removePair(pair.id)}
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={addPair}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Добавить пару
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Пояснение (показывается после ответа)</Label>
        <Textarea
          value={content.explanation || ""}
          onChange={(e) => onChange({ ...content, explanation: e.target.value })}
          placeholder="Объяснение правильных соответствий..."
          rows={2}
        />
      </div>

      <div className="flex items-center gap-2">
        <Label>Баллы:</Label>
        <Input
          type="number"
          value={content.points || pairs.length}
          onChange={(e) => onChange({ ...content, points: parseInt(e.target.value) || 1 })}
          className="w-20"
          min={1}
        />
      </div>
    </div>
  );
}