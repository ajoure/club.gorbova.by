import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuizMultipleOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuizMultipleContent {
  question: string;
  options: QuizMultipleOption[];
  explanation?: string;
  points?: number;
  partialCredit?: boolean; // Allow partial points
}

interface QuizMultipleBlockProps {
  content: QuizMultipleContent;
  onChange: (content: QuizMultipleContent) => void;
  isEditing?: boolean;
  userAnswer?: string[];
  isSubmitted?: boolean;
  onSubmit?: (answerIds: string[]) => void;
  onReset?: () => void;
}

export function QuizMultipleBlock({ 
  content, 
  onChange, 
  isEditing = true,
  userAnswer,
  isSubmitted,
  onSubmit,
  onReset,
}: QuizMultipleBlockProps) {
  const options = content.options || [];
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>(userAnswer || []);

  const addOption = () => {
    const newOption: QuizMultipleOption = {
      id: crypto.randomUUID(),
      text: "",
      isCorrect: false,
    };
    onChange({ ...content, options: [...options, newOption] });
  };

  const updateOption = (id: string, field: keyof QuizMultipleOption, value: string | boolean) => {
    onChange({
      ...content,
      options: options.map((opt) =>
        opt.id === id ? { ...opt, [field]: value } : opt
      ),
    });
  };

  const removeOption = (id: string) => {
    onChange({ ...content, options: options.filter((opt) => opt.id !== id) });
  };

  const toggleAnswer = (id: string) => {
    if (isSubmitted) return;
    setSelectedAnswers(prev => 
      prev.includes(id) 
        ? prev.filter(a => a !== id)
        : [...prev, id]
    );
  };

  const handleSubmit = () => {
    if (selectedAnswers.length > 0 && onSubmit) {
      onSubmit(selectedAnswers);
    }
  };

  const getOptionStyle = (option: QuizMultipleOption) => {
    if (!isSubmitted) {
      return selectedAnswers.includes(option.id) ? "border-primary bg-primary/5" : "";
    }
    
    const isSelected = selectedAnswers.includes(option.id);
    if (option.isCorrect && isSelected) return "border-green-500 bg-green-500/10";
    if (option.isCorrect && !isSelected) return "border-amber-500 bg-amber-500/10"; // Missed correct
    if (!option.isCorrect && isSelected) return "border-red-500 bg-red-500/10"; // Wrong selection
    return "opacity-50";
  };

  // Student view
  if (!isEditing) {
    const correctIds = options.filter(o => o.isCorrect).map(o => o.id);
    const isFullyCorrect = isSubmitted && 
      correctIds.every(id => selectedAnswers.includes(id)) &&
      selectedAnswers.every(id => correctIds.includes(id));

    return (
      <div className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="font-medium text-lg">{content.question || "Вопрос не задан"}</div>
        <p className="text-sm text-muted-foreground">Выберите все правильные варианты</p>
        
        <div className="space-y-2">
          {options.map((option) => (
            <div
              key={option.id}
              onClick={() => toggleAnswer(option.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                "hover:bg-muted/50",
                getOptionStyle(option)
              )}
            >
              <Checkbox 
                checked={selectedAnswers.includes(option.id)}
                disabled={isSubmitted}
              />
              <span className="flex-1">{option.text}</span>
              {isSubmitted && option.isCorrect && (
                <Check className="h-5 w-5 text-green-500" />
              )}
              {isSubmitted && selectedAnswers.includes(option.id) && !option.isCorrect && (
                <X className="h-5 w-5 text-red-500" />
              )}
            </div>
          ))}
        </div>

        {!isSubmitted ? (
          <Button 
            onClick={handleSubmit} 
            disabled={selectedAnswers.length === 0}
            className="w-full"
          >
            Проверить ответ
          </Button>
        ) : (
          <div className="space-y-3">
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              isFullyCorrect ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"
            )}>
              {isFullyCorrect ? (
                <>
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Все ответы правильные!</span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5" />
                  <span className="font-medium">Не все ответы верны</span>
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
          placeholder="Введите вопрос..."
          className="font-medium"
        />
      </div>

      <div className="space-y-2">
        <Label>Варианты ответа (отметьте правильные)</Label>
        <div className="space-y-2">
          {options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <Checkbox
                checked={option.isCorrect}
                onCheckedChange={(checked) => updateOption(option.id, "isCorrect", !!checked)}
                className={cn(
                  option.isCorrect && "border-green-500 bg-green-500 text-white"
                )}
              />
              <Input
                value={option.text}
                onChange={(e) => updateOption(option.id, "text", e.target.value)}
                placeholder={`Вариант ${index + 1}...`}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeOption(option.id)}
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          onClick={addOption}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Добавить вариант
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Пояснение (показывается после ответа)</Label>
        <Input
          value={content.explanation || ""}
          onChange={(e) => onChange({ ...content, explanation: e.target.value })}
          placeholder="Объяснение правильных ответов..."
        />
      </div>

      <div className="flex items-center gap-4">
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
    </div>
  );
}
