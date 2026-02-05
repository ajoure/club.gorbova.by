import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle2, 
  Plus, 
  Trash2,
  Lightbulb,
  Sparkles,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface FormStep {
  id: string;
  title: string;
  description: string;
  inputType: 'textarea' | 'text' | 'number' | 'select';
  options?: string[];
  required: boolean;
  helperText?: string;
  helperTextByRole?: Record<string, string>;
}

export interface SequentialFormContent {
  title?: string;
  steps: FormStep[];
  submitButtonText: string;
}

interface SequentialFormBlockProps {
  content: SequentialFormContent;
  onChange: (content: SequentialFormContent) => void;
  isEditing?: boolean;
  // Player mode props
  answers?: Record<string, string>;
  onAnswersChange?: (answers: Record<string, string>) => void;
  onComplete?: () => void;
  isCompleted?: boolean;
  userRole?: string;
  // PATCH-4/5: AI summary props
  savedSummary?: string;
  onSummaryGenerated?: (summary: string) => void;
}

// Default 10 steps for Point B
const DEFAULT_STEPS: FormStep[] = [
  { id: '1', title: 'Финансовая цель', description: 'Какой доход в месяц я хочу получать через 12 месяцев?', inputType: 'textarea', required: true },
  { id: '2', title: 'Финансовая модель', description: 'За счёт чего именно будет формироваться этот доход?', inputType: 'textarea', required: true },
  { id: '3', title: 'Клиентская модель', description: 'С какими клиентами я работаю (тип, масштаб, формат)?', inputType: 'textarea', required: true },
  { id: '4', title: 'Формат работы', description: 'Как выглядит мой рабочий формат (часы, участие, роль)?', inputType: 'textarea', required: true },
  { id: '5', title: 'Загрузка', description: 'Сколько часов в неделю я готов(а) работать?', inputType: 'number', required: true },
  { id: '6', title: 'Роль в бизнесе', description: 'Что я делаю лично, а что не делаю?', inputType: 'textarea', required: true },
  { id: '7', title: 'Команда/ресурсы', description: 'Нужны ли люди, сервисы, автоматизация?', inputType: 'textarea', required: true },
  { id: '8', title: 'Риски', description: 'Какие риски я осознанно беру и какие исключаю?', inputType: 'textarea', required: true },
  { id: '9', title: 'Ограничения', description: 'От чего я отказываюсь ради этой цели?', inputType: 'textarea', required: true },
  { id: '10', title: 'Критерий достижения', description: 'По каким признакам я пойму, что точка B достигнута?', inputType: 'textarea', required: true },
];

const DEFAULT_CONTENT: SequentialFormContent = {
  title: 'Формула точки B',
  steps: DEFAULT_STEPS,
  submitButtonText: 'Формула точки B сформирована',
};

export function SequentialFormBlock({ 
  content = DEFAULT_CONTENT, 
  onChange, 
  isEditing = true,
  answers = {},
  onAnswersChange,
  onComplete,
  isCompleted = false,
  userRole,
  savedSummary,
  onSummaryGenerated
}: SequentialFormBlockProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  
  // PATCH-1: Local state for inputs to prevent focus loss
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>({});
  
  // PATCH-4: AI summary state
  const [summary, setSummary] = useState<string | null>(savedSummary || null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const steps = content.steps || DEFAULT_STEPS;
  const totalSteps = steps.length;
  const currentStep = steps[currentStepIndex];
  const progressPercent = totalSteps > 0 ? ((currentStepIndex + 1) / totalSteps) * 100 : 0;

  // Initialize local answers from props on mount
  useEffect(() => {
    if (Object.keys(answers).length > 0) {
      setLocalAnswers(answers);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount to prevent overwriting user input

  // Sync savedSummary if changed from outside
  useEffect(() => {
    if (savedSummary && !summary) {
      setSummary(savedSummary);
    }
  }, [savedSummary, summary]);

  // Commit local answers to parent (on blur, navigation, or completion)
  const commitAnswers = useCallback(() => {
    if (Object.keys(localAnswers).length > 0) {
      onAnswersChange?.(localAnswers);
    }
  }, [localAnswers, onAnswersChange]);

  // Count filled answers (use local state for responsiveness)
  const filledCount = useMemo(() => {
    return steps.filter(step => {
      const answer = localAnswers[step.id];
      return answer !== undefined && answer !== '';
    }).length;
  }, [steps, localAnswers]);

  const allFilled = filledCount === totalSteps;
  const currentAnswerFilled = localAnswers[currentStep?.id] !== undefined && localAnswers[currentStep?.id] !== '';

  // Generate ID
  const genId = () => Math.random().toString(36).substring(2, 9);

  // Navigate between steps - commit on navigation
  const goToStep = (index: number) => {
    if (index >= 0 && index < totalSteps) {
      commitAnswers();
      setCurrentStepIndex(index);
    }
  };

  // Update local answer only (no parent call on every keystroke)
  const updateLocalAnswer = (stepId: string, value: string) => {
    setLocalAnswers(prev => ({ ...prev, [stepId]: value }));
  };

  // Add step (editing mode)
  const addStep = () => {
    const newStep: FormStep = {
      id: genId(),
      title: `Шаг ${steps.length + 1}`,
      description: 'Описание вопроса',
      inputType: 'textarea',
      required: true,
    };
    onChange({ ...content, steps: [...steps, newStep] });
  };

  // Update step (editing mode)
  const updateStep = (stepId: string, updates: Partial<FormStep>) => {
    const newSteps = steps.map(s => s.id === stepId ? { ...s, ...updates } : s);
    onChange({ ...content, steps: newSteps });
  };

  // Delete step (editing mode)
  const deleteStep = (stepId: string) => {
    const newSteps = steps.filter(s => s.id !== stepId);
    onChange({ ...content, steps: newSteps });
  };

  // Get helper text for current step (role-aware)
  const getHelperText = (step: FormStep): string | undefined => {
    if (userRole && step.helperTextByRole?.[userRole]) {
      return step.helperTextByRole[userRole];
    }
    return step.helperText;
  };

  // PATCH-4: Generate AI summary
  const generateSummary = async () => {
    // If summary already exists, don't regenerate
    if (savedSummary) {
      setSummary(savedSummary);
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-point-b-summary', {
        body: { answers: localAnswers, steps }
      });

      if (error) {
        console.error('[SequentialFormBlock] AI error:', error);
        toast.error("Не удалось сгенерировать итог");
        return;
      }

      if (data?.summary) {
        setSummary(data.summary);
        onSummaryGenerated?.(data.summary);
        toast.success("Итог сформирован!");
      }
    } catch (e) {
      console.error('[SequentialFormBlock] Error:', e);
      toast.error("Ошибка при генерации итога");
    } finally {
      setIsGenerating(false);
    }
  };

  // PATCH-4: Handle completion with AI summary
  const handleComplete = async () => {
    commitAnswers();
    
    // Generate summary if not already exists
    if (!savedSummary && !summary) {
      await generateSummary();
    }
    
    // Call original onComplete
    if (onComplete) {
      onComplete();
    } else {
      // Fallback for preview/edit mode without callback
      toast.success("Формула сформирована (preview)");
    }
  };

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Заголовок</Label>
          <Input
            value={content.title || ''}
            onChange={(e) => onChange({ ...content, title: e.target.value })}
            placeholder="Формула точки B"
          />
        </div>

        <div className="space-y-2">
          <Label>Текст кнопки завершения</Label>
          <Input
            value={content.submitButtonText || ''}
            onChange={(e) => onChange({ ...content, submitButtonText: e.target.value })}
            placeholder="Формула сформирована"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Шаги ({steps.length})</Label>
            <Button variant="outline" size="sm" onClick={addStep}>
              <Plus className="h-4 w-4 mr-1" />
              Добавить
            </Button>
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {steps.map((step, index) => (
              <Card key={step.id} className="p-3">
                <div className="flex items-start gap-3">
                  <Badge variant="outline" className="shrink-0 mt-1">
                    {index + 1}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    {editingStepId === step.id ? (
                      <div className="space-y-2">
                        <Input
                          value={step.title}
                          onChange={(e) => updateStep(step.id, { title: e.target.value })}
                          placeholder="Заголовок"
                        />
                        <Textarea
                          value={step.description}
                          onChange={(e) => updateStep(step.id, { description: e.target.value })}
                          placeholder="Вопрос"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Select
                            value={step.inputType}
                            onValueChange={(v) => updateStep(step.id, { inputType: v as any })}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="textarea">Текст</SelectItem>
                              <SelectItem value="text">Строка</SelectItem>
                              <SelectItem value="number">Число</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setEditingStepId(null)}
                          >
                            Готово
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div 
                        className="cursor-pointer hover:bg-muted/50 rounded p-1 -m-1"
                        onClick={() => setEditingStepId(step.id)}
                      >
                        <p className="font-medium text-sm">{step.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{step.description}</p>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8"
                    onClick={() => deleteStep(step.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Load defaults button */}
        {steps.length === 0 && (
          <Button
            variant="outline"
            onClick={() => onChange({ ...content, steps: DEFAULT_STEPS })}
            className="w-full"
          >
            Загрузить шаблон "Точка B" (10 шагов)
          </Button>
        )}
      </div>
    );
  }

  // Player mode
  if (!currentStep) {
    return (
      <Card className="py-8 text-center">
        <p className="text-muted-foreground">Нет шагов для заполнения</p>
      </Card>
    );
  }

  const helperText = getHelperText(currentStep);

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      {content.title && (
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{content.title}</h3>
          <Badge variant="outline">
            Шаг {currentStepIndex + 1} из {totalSteps}
          </Badge>
        </div>
      )}

      {/* Step indicators - PATCH-D: use localAnswers instead of answers */}
      <div className="flex gap-1">
        {steps.map((step, idx) => (
          <button
            key={step.id}
            onClick={() => !isCompleted && goToStep(idx)}
            disabled={isCompleted}
            className={`
              flex-1 h-2 rounded-full transition-all
              ${localAnswers[step.id] 
                ? 'bg-primary' 
                : idx === currentStepIndex 
                  ? 'bg-primary/50' 
                  : 'bg-muted'
              }
            `}
          />
        ))}
      </div>

      <Progress value={progressPercent} className="h-1" />

      {/* Current step */}
      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="flex items-start gap-3">
            <Badge className="shrink-0 mt-0.5">{currentStepIndex + 1}</Badge>
            <div>
              <h4 className="font-semibold">{currentStep.title}</h4>
              <p className="text-muted-foreground mt-1">{currentStep.description}</p>
            </div>
          </div>

          {helperText && (
            <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg border border-primary/20">
              <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">{helperText}</p>
            </div>
          )}

          {currentStep.inputType === 'textarea' ? (
            <Textarea
              value={localAnswers[currentStep.id] || ''}
              onChange={(e) => updateLocalAnswer(currentStep.id, e.target.value)}
              onBlur={commitAnswers}
              placeholder="Ваш ответ..."
              rows={4}
              disabled={isCompleted}
            />
          ) : currentStep.inputType === 'number' ? (
            <Input
              type="number"
              value={localAnswers[currentStep.id] || ''}
              onChange={(e) => updateLocalAnswer(currentStep.id, e.target.value)}
              onBlur={commitAnswers}
              placeholder="0"
              disabled={isCompleted}
            />
          ) : (
            <Input
              value={localAnswers[currentStep.id] || ''}
              onChange={(e) => updateLocalAnswer(currentStep.id, e.target.value)}
              onBlur={commitAnswers}
              placeholder="Ваш ответ..."
              disabled={isCompleted}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      {!isCompleted && (
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="outline"
            onClick={() => goToStep(currentStepIndex - 1)}
            disabled={currentStepIndex === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Button>

          {currentStepIndex < totalSteps - 1 ? (
            <Button
              onClick={() => goToStep(currentStepIndex + 1)}
              disabled={currentStep.required && !currentAnswerFilled}
            >
              Дальше
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleComplete}
              disabled={!allFilled || isGenerating}
              variant="default"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Генерация итога...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {content.submitButtonText || 'Завершить'}
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Completion status */}
      {isCompleted && !summary && (
        <div className="flex items-center justify-center gap-2 text-primary py-4">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">Формула сформирована</span>
        </div>
      )}

      {/* PATCH-4: AI Summary Block */}
      {(isCompleted || summary) && summary && (
        <div 
          className="relative rounded-2xl overflow-hidden border border-primary/20 p-6 mt-6"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))',
            boxShadow: '0 12px 40px hsl(var(--primary) / 0.12)'
          }}
        >
          {/* Decorative orb */}
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">Ваша Точка B: Итог</h3>
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert">
              {summary.split('\n').map((line, i) => {
                if (line.startsWith('## ')) {
                  return <h4 key={i} className="font-semibold text-foreground mt-4 mb-2">{line.slice(3)}</h4>;
                }
                if (line.startsWith('- ')) {
                  return <p key={i} className="text-muted-foreground ml-4">• {line.slice(2)}</p>;
                }
                if (line.trim()) {
                  return <p key={i} className="text-muted-foreground">{line}</p>;
                }
                return null;
              })}
            </div>
          </div>
        </div>
      )}

      {/* Progress indicator */}
      {!isCompleted && (
        <p className="text-center text-sm text-muted-foreground">
          Заполнено: {filledCount} из {totalSteps}
        </p>
      )}
    </div>
  );
}
