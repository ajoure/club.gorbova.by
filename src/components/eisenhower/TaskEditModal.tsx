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
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskCategory } from "@/hooks/useTaskCategories";
import { calculateQuadrant } from "@/hooks/useEisenhowerTasks";

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
  categories: TaskCategory[];
  onSave: (updates: {
    content: string;
    quadrant: string;
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
  { value: "inbox", label: "📥 Входящие" },
  { value: "urgent-important", label: "Q1: Срочно и Важно" },
  { value: "not-urgent-important", label: "Q2: Важно, не Срочно" },
  { value: "urgent-not-important", label: "Q3: Срочно, не Важно" },
  { value: "not-urgent-not-important", label: "Q4: Не Срочно, не Важно" },
];

function getQuadrantLabel(importance: number, urgency: number): string {
  if (importance >= 6 && urgency >= 6) return "Q1: Срочно и Важно";
  if (importance >= 6 && urgency < 6) return "Q2: Важно, не Срочно";
  if (importance < 6 && urgency >= 6) return "Q3: Срочно, не Важно";
  return "Q4: Не Срочно, не Важно";
}

export function TaskEditModal({
  open,
  onOpenChange,
  task,
  categories,
  onSave,
  onDelete,
  isNew = false,
  defaultQuadrant = "urgent-important",
}: TaskEditModalProps) {
  const [content, setContent] = useState("");
  const [quadrant, setQuadrant] = useState(defaultQuadrant);
  const [completed, setCompleted] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState<Date | undefined>(undefined);
  const [deadlineTime, setDeadlineTime] = useState("");
  const [categoryId, setCategoryId] = useState<string>("__none__");
  const [importance, setImportance] = useState(5);
  const [urgency, setUrgency] = useState(5);
  const [useManualQuadrant, setUseManualQuadrant] = useState(false);

  useEffect(() => {
    if (task) {
      setContent(task.content);
      setQuadrant(task.quadrant);
      setCompleted(task.completed);
      setDeadlineDate(task.deadline_date ? parse(task.deadline_date, "yyyy-MM-dd", new Date()) : undefined);
      setDeadlineTime(task.deadline_time || "");
      setCategoryId(task.category_id || "__none__");
      setImportance(task.importance ?? 5);
      setUrgency(task.urgency ?? 5);
      setUseManualQuadrant(false);
    } else {
      setContent("");
      setQuadrant(defaultQuadrant);
      setCompleted(false);
      setDeadlineDate(undefined);
      setDeadlineTime("");
      setCategoryId("__none__");
      setImportance(5);
      setUrgency(5);
      setUseManualQuadrant(false);
    }
  }, [task, open, defaultQuadrant]);

  // Auto-calculate quadrant when importance/urgency changes
  useEffect(() => {
    if (!useManualQuadrant) {
      const autoQuadrant = calculateQuadrant(importance, urgency);
      setQuadrant(autoQuadrant);
    }
  }, [importance, urgency, useManualQuadrant]);

  const handleQuadrantChange = (value: string) => {
    setQuadrant(value);
    setUseManualQuadrant(true);
  };

  const handleSave = () => {
    if (!content.trim()) return;
    onSave({
      content: content.trim(),
      quadrant,
      completed,
      deadline_date: deadlineDate ? format(deadlineDate, "yyyy-MM-dd") : null,
      deadline_time: deadlineDate && deadlineTime ? deadlineTime : null,
      category_id: categoryId === "__none__" ? null : categoryId,
      importance,
      urgency,
    });
    onOpenChange(false);
  };

  const calculatedQuadrant = getQuadrantLabel(importance, urgency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "Новая задача" : "Редактировать задачу"}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="content">Название</Label>
            <Input
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Введите название задачи"
            />
          </div>

          <div className="space-y-2">
            <Label>Сфера</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Без категории" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Без категории</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Importance/Urgency Sliders */}
          <div className="space-y-4 p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Важность</Label>
                <span className="text-sm font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">{importance}</span>
              </div>
              <Slider
                value={[importance]}
                onValueChange={([val]) => {
                  setImportance(val);
                  setUseManualQuadrant(false);
                }}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Срочность</Label>
                <span className="text-sm font-medium px-2 py-0.5 rounded bg-destructive/10 text-destructive">{urgency}</span>
              </div>
              <Slider
                value={[urgency]}
                onValueChange={([val]) => {
                  setUrgency(val);
                  setUseManualQuadrant(false);
                }}
                min={1}
                max={10}
                step={1}
                className="w-full"
              />
            </div>
            
            <div className="text-center">
              <span className="text-xs text-muted-foreground">Автоматический квадрант: </span>
              <span className="text-xs font-medium text-primary">{calculatedQuadrant}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Позиция в матрице (или выбрать вручную)</Label>
            <Select value={quadrant} onValueChange={handleQuadrantChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quadrantOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
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