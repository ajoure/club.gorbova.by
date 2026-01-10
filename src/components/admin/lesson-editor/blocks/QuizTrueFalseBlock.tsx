import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuizTrueFalseContent {
  question: string;
  correctAnswer: boolean;
  trueLabel?: string;
  falseLabel?: string;
  explanation?: string;
  points?: number;
}

interface QuizTrueFalseBlockProps {
  content: QuizTrueFalseContent;
  onChange: (content: QuizTrueFalseContent) => void;
  isEditing?: boolean;
  userAnswer?: boolean | null;
  isSubmitted?: boolean;
  onSubmit?: (answer: boolean) => void;
  onReset?: () => void;
}

export function QuizTrueFalseBlock({ 
  content, 
  onChange, 
  isEditing = true,
  userAnswer,
  isSubmitted,
  onSubmit,
  onReset,
}: QuizTrueFalseBlockProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<boolean | null>(userAnswer ?? null);
  
  const trueLabel = content.trueLabel || "Да";
  const falseLabel = content.falseLabel || "Нет";

  const handleSubmit = () => {
    if (selectedAnswer !== null && onSubmit) {
      onSubmit(selectedAnswer);
    }
  };

  const getOptionStyle = (value: boolean) => {
    if (!isSubmitted) {
      return selectedAnswer === value ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "";
    }
    
    if (content.correctAnswer === value) return "border-green-500 bg-green-500/10";
    if (selectedAnswer === value) return "border-red-500 bg-red-500/10";
    return "opacity-50";
  };

  // Student view
  if (!isEditing) {
    const isCorrect = isSubmitted && selectedAnswer === content.correctAnswer;

    return (
      <div className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="font-medium text-lg">{content.question || "Вопрос не задан"}</div>
        
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => !isSubmitted && setSelectedAnswer(true)}
            disabled={isSubmitted}
            className={cn(
              "flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all",
              "hover:bg-muted/50 font-medium",
              getOptionStyle(true)
            )}
          >
            <Check className="h-5 w-5 text-green-600" />
            {trueLabel}
          </button>
          <button
            onClick={() => !isSubmitted && setSelectedAnswer(false)}
            disabled={isSubmitted}
            className={cn(
              "flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all",
              "hover:bg-muted/50 font-medium",
              getOptionStyle(false)
            )}
          >
            <X className="h-5 w-5 text-red-600" />
            {falseLabel}
          </button>
        </div>

        {!isSubmitted ? (
          <Button 
            onClick={handleSubmit} 
            disabled={selectedAnswer === null}
            className="w-full"
          >
            Проверить ответ
          </Button>
        ) : (
          <div className="space-y-3">
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              isCorrect ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
            )}>
              {isCorrect ? (
                <>
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Правильно!</span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5" />
                  <span className="font-medium">Неправильно</span>
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
              <Button variant="outline" onClick={onReset} className="w-full">
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
        <Label>Вопрос</Label>
        <Input
          value={content.question || ""}
          onChange={(e) => onChange({ ...content, question: e.target.value })}
          placeholder="Введите вопрос (да/нет)..."
          className="font-medium"
        />
      </div>

      <div className="space-y-2">
        <Label>Правильный ответ</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onChange({ ...content, correctAnswer: true })}
            className={cn(
              "flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all font-medium",
              content.correctAnswer === true 
                ? "border-green-500 bg-green-500/10" 
                : "border-muted hover:border-green-500/50"
            )}
          >
            <Check className="h-5 w-5" />
            {trueLabel}
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...content, correctAnswer: false })}
            className={cn(
              "flex items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all font-medium",
              content.correctAnswer === false 
                ? "border-green-500 bg-green-500/10" 
                : "border-muted hover:border-green-500/50"
            )}
          >
            <X className="h-5 w-5" />
            {falseLabel}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Текст кнопки "Да"</Label>
          <Input
            value={content.trueLabel || ""}
            onChange={(e) => onChange({ ...content, trueLabel: e.target.value })}
            placeholder="Да / Верно / Правда..."
          />
        </div>
        <div className="space-y-2">
          <Label>Текст кнопки "Нет"</Label>
          <Input
            value={content.falseLabel || ""}
            onChange={(e) => onChange({ ...content, falseLabel: e.target.value })}
            placeholder="Нет / Неверно / Ложь..."
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Пояснение</Label>
        <Input
          value={content.explanation || ""}
          onChange={(e) => onChange({ ...content, explanation: e.target.value })}
          placeholder="Объяснение ответа..."
        />
      </div>

      <div className="flex items-center gap-2">
        <Label>Баллы:</Label>
        <Input
          type="number"
          value={content.points || 1}
          onChange={(e) => onChange({ ...content, points: parseInt(e.target.value) || 1 })}
          className="w-20"
          min={1}
        />
      </div>
    </div>
  );
}
