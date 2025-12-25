import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, Trash2, Sparkles, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPHERES, getGroupedSpheres, getSphereById } from "@/constants/spheres";
import { supabase } from "@/integrations/supabase/client";

interface TaskEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: {
    id: string;
    content: string;
    quadrant: string;
    completed: boolean;
    deadline_date: string | null;
    deadline_time: string | null;
    category_id: string | null;
    importance?: number;
    urgency?: number;
  } | null;
  onSave: (updates: {
    content: string;
    quadrant: string | null;
    completed: boolean;
    deadline_date: string | null;
    deadline_time: string | null;
    category_id: string | null;
    importance: number;
    urgency: number;
  }) => void;
  onDelete: () => void;
  isNew?: boolean;
  defaultQuadrant?: string;
}

const quadrantOptions = [
  { value: "urgent-important", label: "Q1 — Срочно и Важно" },
  { value: "not-urgent-important", label: "Q2 — Важно, не Срочно" },
  { value: "urgent-not-important", label: "Q3 — Срочно, не Важно" },
  { value: "not-urgent-not-important", label: "Q4 — Не Срочно, не Важно" },
];

const quadrantLabels: Record<string, string> = {
  "urgent-important": "Q1 — Срочно и Важно",
  "not-urgent-important": "Q2 — Важно, не Срочно",
  "urgent-not-important": "Q3 — Срочно, не Важно",
  "not-urgent-not-important": "Q4 — Не Срочно, не Важно",
  "inbox": "Планируемые задачи",
};

function getScoresForQuadrant(quadrant: string | null): { importance: number; urgency: number } {
  switch (quadrant) {
    case "urgent-important": return { importance: 8, urgency: 8 };
    case "not-urgent-important": return { importance: 8, urgency: 3 };
    case "urgent-not-important": return { importance: 3, urgency: 8 };
    case "not-urgent-not-important": return { importance: 3, urgency: 3 };
    default: return { importance: 5, urgency: 5 };
  }
}

export function TaskEditModal({
  open,
  onOpenChange,
  task,
  onSave,
  onDelete,
  isNew = false,
  defaultQuadrant,
}: TaskEditModalProps) {
  const [content, setContent] = useState("");
  const [quadrant, setQuadrant] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState<Date | undefined>(undefined);
  const [deadlineTime, setDeadlineTime] = useState("");
  const [sphereId, setSphereId] = useState<string>("none");
  
  // AI Priority state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState<{ quadrant: string; reason: string } | null>(null);
  const [useAiRecommendation, setUseAiRecommendation] = useState(false);

  const groupedSpheres = getGroupedSpheres();

  useEffect(() => {
    if (task) {
      setContent(task.content);
      setQuadrant(task.quadrant === "inbox" ? null : task.quadrant);
      setCompleted(task.completed);
      setDeadlineDate(task.deadline_date ? parse(task.deadline_date, "yyyy-MM-dd", new Date()) : undefined);
      setDeadlineTime(task.deadline_time || "");
      setSphereId(task.category_id || "none");
      setAiRecommendation(null);
      setUseAiRecommendation(false);
    } else {
      // New task - start with empty/null values
      setContent("");
      setQuadrant(null); // No priority by default for new tasks
      setCompleted(false);
      setDeadlineDate(undefined);
      setDeadlineTime("");
      setSphereId("none");
      setAiRecommendation(null);
      setUseAiRecommendation(false);
    }
  }, [task, open]);

  const requestAiAnalysis = async () => {
    if (!content.trim()) return;
    
    setAiLoading(true);
    try {
      const sphere = getSphereById(sphereId);
      
      const { data, error } = await supabase.functions.invoke("analyze-task-priority", {
        body: {
          title: content,
          category: sphere.name !== "Без категории" ? sphere.name : null,
          deadline_date: deadlineDate ? format(deadlineDate, "yyyy-MM-dd") : null,
          deadline_time: deadlineTime || null,
        },
      });

      if (error) throw error;

      if (data?.quadrant) {
        setAiRecommendation({
          quadrant: data.quadrant,
          reason: data.reason || "AI рекомендация",
        });
      }
    } catch (error) {
      console.error("AI analysis error:", error);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAcceptRecommendation = () => {
    if (aiRecommendation) {
      setQuadrant(aiRecommendation.quadrant);
      setUseAiRecommendation(true);
    }
  };

  const handleQuadrantChange = (value: string) => {
    if (value === "__none__") {
      setQuadrant(null);
    } else {
      setQuadrant(value);
    }
    setUseAiRecommendation(false);
  };

  const handleSave = () => {
    if (!content.trim()) return;
    
    // If no quadrant selected (neither AI nor manual), task stays in "inbox" (planned)
    const finalQuadrant = quadrant || "inbox";
    const scores = getScoresForQuadrant(finalQuadrant === "inbox" ? null : finalQuadrant);
    
    onSave({
      content: content.trim(),
      quadrant: finalQuadrant,
      completed,
      deadline_date: deadlineDate ? format(deadlineDate, "yyyy-MM-dd") : null,
      deadline_time: deadlineDate && deadlineTime ? deadlineTime : null,
      category_id: sphereId === "none" ? null : sphereId,
      importance: scores.importance,
      urgency: scores.urgency,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новая задача" : "Редактировать задачу"}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="content">Название задачи</Label>
            <Input
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Введите название задачи"
            />
          </div>

          <div className="space-y-2">
            <Label>Сфера</Label>
            <Select value={sphereId} onValueChange={setSphereId}>
              <SelectTrigger>
                <SelectValue placeholder="Без категории" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {groupedSpheres.map((group) => (
                  <SelectGroup key={group.group}>
                    <SelectLabel className="text-xs text-muted-foreground">{group.group}</SelectLabel>
                    {group.spheres.map((sphere) => (
                      <SelectItem key={sphere.id} value={sphere.id}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: sphere.color }}
                          />
                          {sphere.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Дедлайн</Label>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "flex-1 justify-start text-left font-normal",
                      !deadlineDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {deadlineDate ? format(deadlineDate, "dd.MM.yyyy", { locale: ru }) : "Выберите дату"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={deadlineDate}
                    onSelect={(date) => {
                      setDeadlineDate(date);
                      if (!date) setDeadlineTime("");
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={deadlineTime}
                onChange={(e) => setDeadlineTime(e.target.value)}
                disabled={!deadlineDate}
                className="w-[120px]"
              />
            </div>
          </div>

          {/* AI Priority Section */}
          <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">AI-ассистент: приоритет задачи</Label>
              </div>
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={requestAiAnalysis}
                disabled={aiLoading || !content.trim()}
              >
                {aiLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Анализировать"
                )}
              </Button>
            </div>

            {aiRecommendation && (
              <div className="space-y-2">
                <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
                  <p className="text-sm font-medium text-primary">
                    Рекомендуемый приоритет: {quadrantLabels[aiRecommendation.quadrant]}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {aiRecommendation.reason}
                  </p>
                </div>
                
                <Button
                  type="button"
                  variant={useAiRecommendation && quadrant === aiRecommendation.quadrant ? "default" : "outline"}
                  size="sm"
                  onClick={handleAcceptRecommendation}
                  className="w-full gap-1"
                >
                  {useAiRecommendation && quadrant === aiRecommendation.quadrant && (
                    <Check className="w-3 h-3" />
                  )}
                  Принять рекомендацию
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Выбрать приоритет вручную</Label>
            <Select value={quadrant || "__none__"} onValueChange={handleQuadrantChange}>
              <SelectTrigger>
                <SelectValue placeholder="Не выбран" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Не выбран (останется в планируемых)</SelectItem>
                {quadrantOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="completed"
              checked={completed}
              onCheckedChange={(checked) => setCompleted(checked === true)}
            />
            <Label htmlFor="completed" className="cursor-pointer">Выполнено</Label>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          {!isNew && (
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Удалить
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={!content.trim()}>
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
