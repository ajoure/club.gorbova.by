import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Trash2, Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuizOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuizSingleContent {
  question: string;
  options: QuizOption[];
  explanation?: string;
  points?: number;
}

interface QuizSingleBlockProps {
  content: QuizSingleContent;
  onChange: (content: QuizSingleContent) => void;
  isEditing?: boolean;
  // For student view
  userAnswer?: string;
  isSubmitted?: boolean;
  onSubmit?: (answerId: string) => void;
  onReset?: () => void;
}

export function QuizSingleBlock({ 
  content, 
  onChange, 
  isEditing = true,
  userAnswer,
  isSubmitted,
  onSubmit,
  onReset,
}: QuizSingleBlockProps) {
  const options = content.options || [];
  const [selectedAnswer, setSelectedAnswer] = useState<string>(userAnswer || "");

  const addOption = () => {
    const newOption: QuizOption = {
      id: crypto.randomUUID(),
      text: "",
      isCorrect: options.length === 0, // First option is correct by default
    };
    onChange({ ...content, options: [...options, newOption] });
  };

  const updateOption = (id: string, field: keyof QuizOption, value: string | boolean) => {
    const newOptions = options.map((opt) => {
      if (opt.id === id) {
        return { ...opt, [field]: value };
      }
      // If setting isCorrect to true, set others to false
      if (field === "isCorrect" && value === true) {
        return { ...opt, isCorrect: opt.id === id };
      }
      return opt;
    });
    onChange({ ...content, options: newOptions });
  };

  const removeOption = (id: string) => {
    onChange({ ...content, options: options.filter((opt) => opt.id !== id) });
  };

  const handleSubmit = () => {
    if (selectedAnswer && onSubmit) {
      onSubmit(selectedAnswer);
    }
  };

  const getOptionStyle = (option: QuizOption) => {
    if (!isSubmitted) return "";
    if (option.isCorrect) return "border-green-500 bg-green-500/10";
    if (selectedAnswer === option.id && !option.isCorrect) return "border-red-500 bg-red-500/10";
    return "opacity-50";
  };

  // Student view
  if (!isEditing) {
    const correctAnswer = options.find(o => o.isCorrect);
    const isCorrect = isSubmitted && selectedAnswer === correctAnswer?.id;

    return (
      <div className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="font-medium text-lg">{content.question || "Вопрос не задан"}</div>
        
        <RadioGroup 
          value={selectedAnswer} 
          onValueChange={setSelectedAnswer}
          disabled={isSubmitted}
          className="space-y-2"
        >
          {options.map((option) => (
            <Label
              key={option.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                "hover:bg-muted/50",
                selectedAnswer === option.id && !isSubmitted && "border-primary bg-primary/5",
                getOptionStyle(option)
              )}
            >
              <RadioGroupItem value={option.id} />
              <span className="flex-1">{option.text}</span>
              {isSubmitted && option.isCorrect && (
                <Check className="h-5 w-5 text-green-500" />
              )}
              {isSubmitted && selectedAnswer === option.id && !option.isCorrect && (
                <X className="h-5 w-5 text-red-500" />
              )}
            </Label>
          ))}
        </RadioGroup>

        {!isSubmitted ? (
          <Button 
            onClick={handleSubmit} 
            disabled={!selectedAnswer}
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
          placeholder="Введите вопрос..."
          className="font-medium"
        />
      </div>

      <div className="space-y-2">
        <Label>Варианты ответа</Label>
        <div className="space-y-2">
          {options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateOption(option.id, "isCorrect", true)}
                className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                  option.isCorrect 
                    ? "border-green-500 bg-green-500 text-white" 
                    : "border-muted-foreground/30 hover:border-green-500/50"
                )}
              >
                {option.isCorrect && <Check className="h-3 w-3" />}
              </button>
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
          placeholder="Объяснение правильного ответа..."
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
