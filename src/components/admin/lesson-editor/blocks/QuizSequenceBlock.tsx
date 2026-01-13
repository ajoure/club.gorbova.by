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
} from "@dnd-kit/core";
import { 
  arrayMove,
  SortableContext, 
  sortableKeyboardCoordinates, 
  useSortable, 
  verticalListSortingStrategy 
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2, Check, X, RotateCcw, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SequenceItem {
  id: string;
  text: string;
  correctOrder: number;
}

export interface QuizSequenceContent {
  question: string;
  items: SequenceItem[];
  explanation?: string;
  points?: number;
}

// Sprint A+B: Unified answer interface (meta stored in DB columns, not in response)
interface SequenceAnswer {
  order: string[];
  is_submitted?: boolean;
  submitted_at?: string;
}

interface QuizSequenceBlockProps {
  content: QuizSequenceContent;
  onChange: (content: QuizSequenceContent) => void;
  isEditing?: boolean;
  blockId?: string;
  savedAnswer?: SequenceAnswer;
  isSubmitted?: boolean;
  attempts?: number;
  onSubmit?: (answer: SequenceAnswer, isCorrect: boolean, score: number, maxScore: number) => void;
  onReset?: () => void;
}

interface SortableSequenceItemProps {
  item: SequenceItem;
  index: number;
  isSubmitted?: boolean;
  isCorrectPosition?: boolean;
}

function SortableSequenceItem({ item, index, isSubmitted, isCorrectPosition }: SortableSequenceItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-colors",
        "bg-card hover:bg-muted/50",
        !isSubmitted && "cursor-grab active:cursor-grabbing",
        isSubmitted && isCorrectPosition && "border-green-500 bg-green-500/10",
        isSubmitted && !isCorrectPosition && "border-red-500 bg-red-500/10"
      )}
      {...(isSubmitted ? {} : { ...attributes, ...listeners })}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0",
        isSubmitted && isCorrectPosition && "bg-green-500 text-white",
        isSubmitted && !isCorrectPosition && "bg-red-500 text-white",
        !isSubmitted && "bg-muted"
      )}>
        {index + 1}
      </div>
      
      {!isSubmitted && (
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      )}
      
      <span className="flex-1">{item.text}</span>
      
      {isSubmitted && (
        isCorrectPosition ? (
          <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
        ) : (
          <X className="h-5 w-5 text-red-500 flex-shrink-0" />
        )
      )}
    </div>
  );
}

export function QuizSequenceBlock({
  content,
  onChange,
  isEditing = true,
  blockId,
  savedAnswer,
  isSubmitted,
  attempts,
  onSubmit,
  onReset,
}: QuizSequenceBlockProps) {
  const items = content.items || [];
  const [currentOrder, setCurrentOrder] = useState<string[]>([]);
  
  // Sprint A+B: Guard to prevent re-initialization after first load
  const initializedRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sprint A+B: Single unified initialization effect
  useEffect(() => {
    if (isEditing || items.length === 0 || initializedRef.current) return;
    
    // Priority: savedAnswer > shuffle
    if (savedAnswer?.order && savedAnswer.order.length > 0) {
      setCurrentOrder(savedAnswer.order);
    } else {
      // Shuffle only if no saved answer
      const ids = items.map(item => item.id);
      const shuffled = [...ids];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setCurrentOrder(shuffled);
    }
    
    initializedRef.current = true;
  }, [isEditing, items.length, savedAnswer]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = currentOrder.indexOf(active.id as string);
      const newIndex = currentOrder.indexOf(over.id as string);
      setCurrentOrder(arrayMove(currentOrder, oldIndex, newIndex));
    }
  };

  const checkCorrectness = (): { isCorrect: boolean; correctCount: number; positionCorrect: boolean[] } => {
    const correctOrderIds = [...items]
      .sort((a, b) => a.correctOrder - b.correctOrder)
      .map(item => item.id);
    
    const positionCorrect = currentOrder.map((id, index) => id === correctOrderIds[index]);
    const correctCount = positionCorrect.filter(Boolean).length;
    
    return { 
      isCorrect: correctCount === items.length, 
      correctCount,
      positionCorrect,
    };
  };

  // Sprint A+B: Updated submit with unified response format
  const handleSubmit = () => {
    if (!onSubmit) return;
    
    const { isCorrect, correctCount } = checkCorrectness();
    const maxScore = content.points || items.length;
    const score = (maxScore === items.length) 
      ? correctCount 
      : Math.floor((correctCount / items.length) * maxScore);
    
    const answer: SequenceAnswer = {
      order: currentOrder,
      is_submitted: true,
      submitted_at: new Date().toISOString(),
    };
    
    onSubmit(answer, isCorrect, score, maxScore);
  };

  const handleReset = () => {
    // Reshuffle
    const ids = items.map(item => item.id);
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setCurrentOrder(shuffled);
    initializedRef.current = true; // Keep guard active
    onReset?.();
  };

  // Editor functions
  const addItem = () => {
    const newItem: SequenceItem = {
      id: crypto.randomUUID(),
      text: "",
      correctOrder: items.length,
    };
    onChange({ ...content, items: [...items, newItem] });
  };

  const updateItem = (id: string, text: string) => {
    onChange({
      ...content,
      items: items.map((item) => (item.id === id ? { ...item, text } : item)),
    });
  };

  const removeItem = (id: string) => {
    const filtered = items.filter((item) => item.id !== id);
    // Recalculate correct order
    const reordered = filtered.map((item, index) => ({
      ...item,
      correctOrder: index,
    }));
    onChange({ ...content, items: reordered });
  };

  const moveItemInEditor = (fromIndex: number, toIndex: number) => {
    const newItems = arrayMove(items, fromIndex, toIndex).map((item, index) => ({
      ...item,
      correctOrder: index,
    }));
    onChange({ ...content, items: newItems });
  };

  // Student view
  if (!isEditing) {
    const { correctCount, positionCorrect } = isSubmitted ? checkCorrectness() : { correctCount: 0, positionCorrect: [] };
    const allCorrect = isSubmitted && correctCount === items.length;

    // Get items in current order for rendering
    const orderedItems = currentOrder.map(id => items.find(item => item.id === id)).filter(Boolean) as SequenceItem[];

    return (
      <div className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="font-medium text-lg">{content.question || "Расставьте в правильном порядке"}</div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={currentOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {orderedItems.map((item, index) => (
                <SortableSequenceItem
                  key={item.id}
                  item={item}
                  index={index}
                  isSubmitted={isSubmitted}
                  isCorrectPosition={positionCorrect[index]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {!isSubmitted ? (
          <Button onClick={handleSubmit} className="w-full">
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
                    Правильно {correctCount} из {items.length} позиций
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
          placeholder="Расставьте шаги в правильном порядке..."
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>Элементы последовательности (в правильном порядке)</Label>
        <p className="text-xs text-muted-foreground">
          Порядок элементов здесь — это правильный ответ. Студент увидит их перемешанными.
        </p>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium flex-shrink-0">
                {index + 1}
              </div>
              <Input
                value={item.text}
                onChange={(e) => updateItem(item.id, e.target.value)}
                placeholder={`Элемент ${index + 1}...`}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeItem(item.id)}
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={addItem}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Добавить элемент
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Пояснение (показывается после ответа)</Label>
        <Textarea
          value={content.explanation || ""}
          onChange={(e) => onChange({ ...content, explanation: e.target.value })}
          placeholder="Объяснение правильной последовательности..."
          rows={2}
        />
      </div>

      <div className="flex items-center gap-2">
        <Label>Баллы:</Label>
        <Input
          type="number"
          value={content.points || items.length}
          onChange={(e) => onChange({ ...content, points: parseInt(e.target.value) || 1 })}
          className="w-20"
          min={1}
        />
      </div>
    </div>
  );
}