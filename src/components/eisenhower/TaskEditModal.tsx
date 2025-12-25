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
import { CalendarIcon, Trash2, Sparkles, Loader2, Check, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPHERES, getGroupedSpheres, getSphereById } from "@/constants/spheres";
import { supabase } from "@/integrations/supabase/client";
import { useTaskCategories, TaskCategory } from "@/hooks/useTaskCategories";
import { CategoryManager } from "./CategoryManager";
import { toast } from "@/hooks/use-toast";

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
  "planned": "Планируемые задачи",
};

// Check if a sphere ID is a UUID (user custom category) vs predefined sphere
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function getScoresForQuadrant(quadrant: string | null): { importance: number; urgency: number } {
  switch (quadrant) {
    case "urgent-important": return { importance: 8, urgency: 8 };
    case "not-urgent-important": return { importance: 8, urgency: 3 };
    case "urgent-not-important": return { importance: 3, urgency: 8 };
    case "not-urgent-not-important": return { importance: 3, urgency: 3 };
    default: return { importance: 5, urgency: 5 };
  }
}

interface AIRecommendation {
  quadrant: string;
  quadrant_reason: string;
  sphere_id: string | null;
  sphere_name: string | null;
  sphere_reason: string | null;
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
  const [aiRecommendation, setAiRecommendation] = useState<AIRecommendation | null>(null);
  const [useAiQuadrant, setUseAiQuadrant] = useState(false);
  const [useAiSphere, setUseAiSphere] = useState(false);

  // Category management
  const { categories, addCategory, deleteCategory, updateCategory, refetch } = useTaskCategories();
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const groupedSpheres = getGroupedSpheres();

  // Combine predefined spheres with user custom categories
  const allSpheresForSelect = [
    ...groupedSpheres,
    ...(categories.length > 0 ? [{
      group: "Мои сферы",
      spheres: categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        group: "Мои сферы"
      }))
    }] : [])
  ];

  useEffect(() => {
    if (task) {
      setContent(task.content);
      setQuadrant(task.quadrant === "inbox" ? null : task.quadrant);
      setCompleted(task.completed);
      setDeadlineDate(task.deadline_date ? parse(task.deadline_date, "yyyy-MM-dd", new Date()) : undefined);
      setDeadlineTime(task.deadline_time || "");
      setSphereId(task.category_id || "none");
      setAiRecommendation(null);
      setUseAiQuadrant(false);
      setUseAiSphere(false);
    } else {
      // New task - start with empty/null values
      setContent("");
      setQuadrant(null); // No priority by default for new tasks
      setCompleted(false);
      setDeadlineDate(undefined);
      setDeadlineTime("");
      setSphereId("none");
      setAiRecommendation(null);
      setUseAiQuadrant(false);
      setUseAiSphere(false);
    }
  }, [task, open]);

  const requestAiAnalysis = async () => {
    if (!content.trim()) return;
    
    setAiLoading(true);
    try {
      const sphere = getSphereById(sphereId);
      
      // Pass user custom spheres to AI
      const userSpheres = categories.map(c => ({ id: c.id, name: c.name }));
      
      const { data, error } = await supabase.functions.invoke("analyze-task-priority", {
        body: {
          title: content,
          category: sphere.name !== "Без категории" ? sphere.name : null,
          deadline_date: deadlineDate ? format(deadlineDate, "yyyy-MM-dd") : null,
          deadline_time: deadlineTime || null,
          user_spheres: userSpheres,
        },
      });

      if (error) throw error;

      if (data?.quadrant) {
        setAiRecommendation({
          quadrant: data.quadrant,
          quadrant_reason: data.quadrant_reason || data.reason || "AI рекомендация",
          sphere_id: data.sphere_id || null,
          sphere_name: data.sphere_name || null,
          sphere_reason: data.sphere_reason || null,
        });
        
        // Auto-apply AI recommendations
        if (data.quadrant) {
          setQuadrant(data.quadrant);
          setUseAiQuadrant(true);
        }
        if (data.sphere_id) {
          setSphereId(data.sphere_id);
          setUseAiSphere(true);
        }
        
        toast({
          title: "AI-анализ завершён",
          description: "Рекомендации применены. Вы можете изменить их вручную.",
        });
      }
    } catch (error) {
      console.error("AI analysis error:", error);
      toast({
        title: "Ошибка анализа",
        description: "Не удалось получить рекомендации AI",
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleQuadrantChange = (value: string) => {
    if (value === "__none__") {
      setQuadrant(null);
    } else {
      setQuadrant(value);
    }
    setUseAiQuadrant(false);
  };

  const handleSphereChange = (value: string) => {
    setSphereId(value);
    setUseAiSphere(false);
  };

  const handleSave = () => {
    if (!content.trim()) return;
    
    // If no quadrant selected (neither AI nor manual), task stays in "planned"
    const finalQuadrant = quadrant || "planned";
    const scores = getScoresForQuadrant(finalQuadrant === "planned" ? null : finalQuadrant);
    
    // Only use category_id if it's a valid UUID (user custom category)
    // Predefined spheres (like "personal", "work") are not stored in DB
    const categoryId = sphereId === "none" ? null : (isValidUUID(sphereId) ? sphereId : null);
    
    onSave({
      content: content.trim(),
      quadrant: finalQuadrant,
      completed,
      deadline_date: deadlineDate ? format(deadlineDate, "yyyy-MM-dd") : null,
      deadline_time: deadlineDate && deadlineTime ? deadlineTime : null,
      category_id: categoryId,
      importance: scores.importance,
      urgency: scores.urgency,
    });
    onOpenChange(false);
  };

  // Get sphere display info (works for both predefined and custom)
  const getSelectedSphereInfo = () => {
    if (sphereId === "none") return null;
    
    // Check predefined spheres
    const predefined = SPHERES.find(s => s.id === sphereId);
    if (predefined) return predefined;
    
    // Check user categories
    const custom = categories.find(c => c.id === sphereId);
    if (custom) return { ...custom, group: "Мои сферы" };
    
    return null;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
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
              <div className="flex items-center justify-between">
                <Label>Сфера</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategoryManagerOpen(true)}
                >
                  <Settings className="w-3 h-3 mr-1" />
                  Настройки
                </Button>
              </div>
              <div className="relative">
                <Select value={sphereId} onValueChange={handleSphereChange}>
                  <SelectTrigger className={cn(
                    useAiSphere && aiRecommendation?.sphere_id === sphereId && "ring-1 ring-primary"
                  )}>
                    <SelectValue placeholder="Без категории" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {allSpheresForSelect.map((group) => (
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
                {useAiSphere && aiRecommendation?.sphere_id === sphereId && (
                  <span className="absolute -top-2 right-2 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                    AI
                  </span>
                )}
              </div>
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
                  <Label className="text-sm font-medium">AI-ассистент</Label>
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
                  {/* Priority recommendation */}
                  <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
                    <div className="flex items-center gap-2">
                      {useAiQuadrant && quadrant === aiRecommendation.quadrant && (
                        <Check className="w-3 h-3 text-primary shrink-0" />
                      )}
                      <p className="text-sm font-medium text-primary">
                        Приоритет: {quadrantLabels[aiRecommendation.quadrant]}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aiRecommendation.quadrant_reason}
                    </p>
                  </div>
                  
                  {/* Sphere recommendation */}
                  {aiRecommendation.sphere_id && aiRecommendation.sphere_name && (
                    <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
                      <div className="flex items-center gap-2">
                        {useAiSphere && sphereId === aiRecommendation.sphere_id && (
                          <Check className="w-3 h-3 text-primary shrink-0" />
                        )}
                        <p className="text-sm font-medium text-primary">
                          Сфера: {aiRecommendation.sphere_name}
                        </p>
                      </div>
                      {aiRecommendation.sphere_reason && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {aiRecommendation.sphere_reason}
                        </p>
                      )}
                    </div>
                  )}
                  
                  <p className="text-xs text-muted-foreground">
                    Рекомендации применены автоматически. Вы можете изменить их вручную.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Выбрать приоритет вручную</Label>
              <div className="relative">
                <Select value={quadrant || "__none__"} onValueChange={handleQuadrantChange}>
                  <SelectTrigger className={cn(
                    useAiQuadrant && aiRecommendation?.quadrant === quadrant && "ring-1 ring-primary"
                  )}>
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
                {useAiQuadrant && aiRecommendation?.quadrant === quadrant && (
                  <span className="absolute -top-2 right-2 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                    AI
                  </span>
                )}
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

      <CategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        categories={categories}
        onAdd={addCategory}
        onUpdate={updateCategory}
        onDelete={deleteCategory}
      />
    </>
  );
}
