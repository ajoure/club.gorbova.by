import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BlankItem {
  id: string;
  correctAnswer: string;
  acceptedVariants?: string[]; // Alternative correct answers
  inputType: 'text' | 'dropdown';
  dropdownOptions?: string[];
}

export interface QuizFillBlankContent {
  textBefore: string;
  blanks: BlankItem[];
  textAfter?: string;
  explanation?: string;
  points?: number;
  caseSensitive?: boolean;
}

// Sprint A+B: Unified answer interface (meta stored in DB columns, not in response)
interface FillBlankAnswer {
  answers: Record<string, string>; // key = blank.id, value = user answer
  is_submitted?: boolean;
  submitted_at?: string;
}

interface QuizFillBlankBlockProps {
  content: QuizFillBlankContent;
  onChange: (content: QuizFillBlankContent) => void;
  isEditing?: boolean;
  blockId?: string;
  savedAnswer?: FillBlankAnswer;
  isSubmitted?: boolean;
  attempts?: number;
  onSubmit?: (answer: FillBlankAnswer, isCorrect: boolean, score: number, maxScore: number) => void;
  onReset?: () => void;
}

export function QuizFillBlankBlock({ 
  content, 
  onChange, 
  isEditing = true,
  blockId,
  savedAnswer,
  isSubmitted,
  attempts,
  onSubmit,
  onReset,
}: QuizFillBlankBlockProps) {
  const blanks = content.blanks || [];
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Sprint A+B: Restore saved answers using blank.id as key
  useEffect(() => {
    if (savedAnswer?.answers) {
      setAnswers(savedAnswer.answers);
    }
  }, [savedAnswer]);

  const addBlank = () => {
    const newBlank: BlankItem = {
      id: crypto.randomUUID(),
      correctAnswer: "",
      inputType: 'text',
      acceptedVariants: [],
      dropdownOptions: [],
    };
    onChange({ ...content, blanks: [...blanks, newBlank] });
  };

  const updateBlank = (id: string, updates: Partial<BlankItem>) => {
    onChange({
      ...content,
      blanks: blanks.map((blank) =>
        blank.id === id ? { ...blank, ...updates } : blank
      ),
    });
  };

  const removeBlank = (id: string) => {
    onChange({ ...content, blanks: blanks.filter((b) => b.id !== id) });
  };

  // Sprint A+B: Use blank.id as key instead of index
  const updateAnswer = (blankId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [blankId]: value }));
  };

  const isAnswerCorrect = (blank: BlankItem, answer: string) => {
    if (!answer) return false;
    const normalize = (s: string) => content.caseSensitive ? s.trim() : s.trim().toLowerCase();
    const correctNorm = normalize(blank.correctAnswer);
    const answerNorm = normalize(answer);
    
    if (correctNorm === answerNorm) return true;
    
    return (blank.acceptedVariants || []).some(v => normalize(v) === answerNorm);
  };

  // Sprint A+B: Updated submit with unified response format and blank.id validation
  const handleSubmit = () => {
    if (!onSubmit) return;
    
    let correctCount = 0;
    blanks.forEach(blank => {
      const userAns = answers[blank.id] || "";
      if (isAnswerCorrect(blank, userAns)) {
        correctCount++;
      }
    });
    
    const maxScore = content.points || blanks.length;
    // Sprint A+B: Fixed score calculation without strange jumps
    const score = (maxScore === blanks.length)
      ? correctCount
      : Math.floor((correctCount / blanks.length) * maxScore);
    const isCorrect = correctCount === blanks.length;
    
    const answer: FillBlankAnswer = {
      answers,
      is_submitted: true,
      submitted_at: new Date().toISOString(),
    };
    
    onSubmit(answer, isCorrect, score, maxScore);
  };

  const handleReset = () => {
    setAnswers({});
    onReset?.();
  };

  // Student view
  if (!isEditing) {
    const allCorrect = isSubmitted && blanks.every(b => isAnswerCorrect(b, answers[b.id] || ""));

    return (
      <div className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="text-lg leading-relaxed">
          <span>{content.textBefore}</span>
          {blanks.map((blank, index) => (
            <span key={blank.id} className="inline-flex items-center mx-1">
              {blank.inputType === 'dropdown' ? (
                <Select
                  value={answers[blank.id] || ""}
                  onValueChange={(v) => updateAnswer(blank.id, v)}
                  disabled={isSubmitted}
                >
                  <SelectTrigger className={cn(
                    "w-[150px] inline-flex",
                    isSubmitted && (isAnswerCorrect(blank, answers[blank.id] || "") 
                      ? "border-green-500 bg-green-500/10" 
                      : "border-red-500 bg-red-500/10")
                  )}>
                    <SelectValue placeholder="Выберите..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(blank.dropdownOptions || []).map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={answers[blank.id] || ""}
                  onChange={(e) => updateAnswer(blank.id, e.target.value)}
                  disabled={isSubmitted}
                  className={cn(
                    "w-[150px] inline-flex",
                    isSubmitted && (isAnswerCorrect(blank, answers[blank.id] || "") 
                      ? "border-green-500 bg-green-500/10" 
                      : "border-red-500 bg-red-500/10")
                  )}
                  placeholder="..."
                />
              )}
              {isSubmitted && (
                isAnswerCorrect(blank, answers[blank.id] || "") 
                  ? <Check className="h-4 w-4 text-green-500 ml-1" />
                  : <X className="h-4 w-4 text-red-500 ml-1" />
              )}
            </span>
          ))}
          {content.textAfter && <span>{content.textAfter}</span>}
        </div>

        {!isSubmitted ? (
          <Button 
            onClick={handleSubmit} 
            disabled={blanks.some(b => !answers[b.id])}
            className="w-full"
          >
            Проверить ответ
          </Button>
        ) : (
          <div className="space-y-3">
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              allCorrect ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
            )}>
              {allCorrect ? (
                <>
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Правильно!</span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5" />
                  <span className="font-medium">Есть ошибки</span>
                </>
              )}
            </div>
            
            {!allCorrect && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <span className="font-medium">Правильные ответы: </span>
                {blanks.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 && ", "}
                    <span className="font-medium text-primary">{b.correctAnswer}</span>
                  </span>
                ))}
              </div>
            )}

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
        <Label>Текст перед пропусками</Label>
        <Textarea
          value={content.textBefore || ""}
          onChange={(e) => onChange({ ...content, textBefore: e.target.value })}
          placeholder="Введите текст до первого пропуска..."
          className="min-h-[60px]"
        />
      </div>

      <div className="space-y-3">
        <Label>Пропуски для заполнения</Label>
        {blanks.map((blank, index) => (
          <div key={blank.id} className="border rounded-lg p-3 space-y-2 bg-card/50">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                Пропуск {index + 1}
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeBlank(blank.id)}
                className="h-7 w-7 text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Тип ввода</Label>
                <Select
                  value={blank.inputType}
                  onValueChange={(v: 'text' | 'dropdown') => updateBlank(blank.id, { inputType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Текстовое поле</SelectItem>
                    <SelectItem value="dropdown">Выбор из списка</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Правильный ответ</Label>
                <Input
                  value={blank.correctAnswer}
                  onChange={(e) => updateBlank(blank.id, { correctAnswer: e.target.value })}
                  placeholder="Ответ..."
                />
              </div>
            </div>

            {blank.inputType === 'dropdown' && (
              <div>
                <Label className="text-xs">Варианты для выбора (через запятую)</Label>
                <Input
                  value={(blank.dropdownOptions || []).join(", ")}
                  onChange={(e) => updateBlank(blank.id, { 
                    dropdownOptions: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                  })}
                  placeholder="Вариант 1, Вариант 2, Вариант 3..."
                />
              </div>
            )}

            <div>
              <Label className="text-xs">Допустимые варианты ответа (через запятую)</Label>
              <Input
                value={(blank.acceptedVariants || []).join(", ")}
                onChange={(e) => updateBlank(blank.id, { 
                  acceptedVariants: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                })}
                placeholder="Синоним 1, Синоним 2..."
              />
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={addBlank}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Добавить пропуск
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Текст после пропусков (опционально)</Label>
        <Input
          value={content.textAfter || ""}
          onChange={(e) => onChange({ ...content, textAfter: e.target.value })}
          placeholder="Текст в конце..."
        />
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