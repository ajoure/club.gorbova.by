import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepItem {
  id: string;
  title: string;
  description: string;
}

export interface StepsContent {
  steps: StepItem[];
  orientation?: 'vertical' | 'horizontal';
}

interface StepsBlockProps {
  content: StepsContent;
  onChange: (content: StepsContent) => void;
  isEditing?: boolean;
}

export function StepsBlock({ content, onChange, isEditing = true }: StepsBlockProps) {
  const steps = content.steps || [];
  const orientation = content.orientation || 'vertical';

  const addStep = () => {
    const newStep: StepItem = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
    };
    onChange({ ...content, steps: [...steps, newStep] });
  };

  const updateStep = (id: string, field: keyof StepItem, value: string) => {
    onChange({
      ...content,
      steps: steps.map((step) =>
        step.id === id ? { ...step, [field]: value } : step
      ),
    });
  };

  const removeStep = (id: string) => {
    onChange({ ...content, steps: steps.filter((step) => step.id !== id) });
  };

  if (!isEditing) {
    if (orientation === 'horizontal') {
      return (
        <div className="flex items-start gap-0 overflow-x-auto pb-2">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-start flex-shrink-0">
              <div className="flex flex-col items-center min-w-[150px] max-w-[200px]">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                  "bg-primary/20 text-primary border-2 border-primary"
                )}>
                  {index + 1}
                </div>
                <div className="mt-3 text-center px-2">
                  <div className="font-semibold text-sm">
                    {step.title || `Шаг ${index + 1}`}
                  </div>
                  {step.description && (
                    <div 
                      className="text-xs text-muted-foreground mt-1 line-clamp-3"
                      dangerouslySetInnerHTML={{ __html: step.description }}
                    />
                  )}
                </div>
              </div>
              {index < steps.length - 1 && (
                <div className="h-0.5 w-8 bg-primary/30 mt-5 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                "bg-primary/20 text-primary border-2 border-primary"
              )}>
                {index + 1}
              </div>
              {index < steps.length - 1 && (
                <div className="w-0.5 flex-1 bg-primary/30 mt-2" />
              )}
            </div>
            <div className="flex-1 pb-6">
              <div className="bg-card/30 backdrop-blur-sm rounded-xl p-4 border border-border/50">
                <div className="font-semibold text-foreground">
                  {step.title || `Шаг ${index + 1}`}
                </div>
                {step.description && (
                  <div 
                    className="prose prose-sm max-w-none dark:prose-invert mt-2 text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: step.description }}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant={orientation === 'vertical' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange({ ...content, orientation: 'vertical' })}
        >
          Вертикально
        </Button>
        <Button
          variant={orientation === 'horizontal' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange({ ...content, orientation: 'horizontal' })}
        >
          Горизонтально
        </Button>
      </div>
      
      {steps.map((step, index) => (
        <div 
          key={step.id} 
          className="border rounded-xl p-4 bg-card/30 backdrop-blur-sm space-y-3"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{index + 1}</span>
            </div>
            <span className="text-sm text-muted-foreground font-medium">
              Шаг {index + 1}
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeStep(step.id)}
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Input
            value={step.title}
            onChange={(e) => updateStep(step.id, "title", e.target.value)}
            placeholder="Заголовок шага..."
            className="font-medium"
          />
          <Textarea
            value={step.description}
            onChange={(e) => updateStep(step.id, "description", e.target.value)}
            placeholder="Описание шага (HTML)..."
            className="min-h-[60px] font-mono text-sm"
          />
        </div>
      ))}
      <Button
        variant="outline"
        onClick={addStep}
        className="w-full border-dashed"
      >
        <Plus className="h-4 w-4 mr-2" />
        Добавить шаг
      </Button>
    </div>
  );
}
