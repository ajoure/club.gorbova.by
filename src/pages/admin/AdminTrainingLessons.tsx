import { useState, useCallback, memo, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useTrainingLessons, TrainingLesson, TrainingLessonFormData, CompletionMode } from "@/hooks/useTrainingLessons";
import { LessonThumbnailEditor } from "@/components/admin/trainings/LessonThumbnailEditor";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimezoneSelector } from "@/components/admin/payments/TimezoneSelector";
import { format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Pencil,
  Trash2,
  BookOpen,
  ArrowLeft,
  Video,
  Music,
  FileText,
  Files,
  Eye,
  EyeOff,
  Clock,
  ChevronRight,
  Blocks,
  Users,
  CalendarIcon,
  Lock,
  Info,
  Layers,
  Copy,
  GripVertical,
} from "lucide-react";
import { ContentCreationWizard } from "@/components/admin/trainings/ContentCreationWizard";
import { CopyMoveDialog } from "@/components/admin/trainings/CopyMoveDialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const contentTypeOptions = [
  { value: "article", label: "Статья", icon: FileText },
  { value: "video", label: "Видео", icon: Video },
  { value: "audio", label: "Аудио", icon: Music },
  { value: "document", label: "Документ", icon: Files },
  { value: "mixed", label: "Смешанный", icon: BookOpen },
];

const completionModeOptions = [
  { value: "manual", label: "Ручная отметка", description: "Ученик сам отмечает урок пройденным" },
  { value: "view_all_blocks", label: "Просмотр всех блоков", description: "Автоматически при просмотре всех блоков" },
  { value: "watch_video", label: "Просмотр видео", description: "Автоматически при полном просмотре видео" },
  { value: "kvest", label: "Прохождение квеста", description: "Пошаговое прохождение интерактивного урока" },
];

// ─── SortableItem wrapper ───

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none p-1 text-muted-foreground hover:text-foreground shrink-0"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// Helper function for slug generation
const generateSlug = (title: string) => {
  return title
    .toLowerCase()
    .replace(/[а-яё]/gi, (char) => {
      const ru = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
      const en = ["a","b","v","g","d","e","yo","zh","z","i","j","k","l","m","n","o","p","r","s","t","u","f","h","c","ch","sh","sch","","y","","e","yu","ya"];
      const idx = ru.indexOf(char.toLowerCase());
      return idx >= 0 ? en[idx] : char;
    })
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

// Form component - MUST be outside main component to prevent focus loss on re-renders
interface LessonFormContentProps {
  formData: TrainingLessonFormData;
  onFormDataChange: (updater: (prev: TrainingLessonFormData) => TrainingLessonFormData) => void;
  editingLesson: TrainingLesson | null;
  publishDate: Date | undefined;
  setPublishDate: (date: Date | undefined) => void;
  publishTime: string;
  setPublishTime: (time: string) => void;
  publishTimezone: string;
  setPublishTimezone: (tz: string) => void;
}

const LessonFormContent = memo(function LessonFormContent({ 
  formData, 
  onFormDataChange,
  editingLesson,
  publishDate,
  setPublishDate,
  publishTime,
  setPublishTime,
  publishTimezone,
  setPublishTimezone,
}: LessonFormContentProps) {
  return (
    <div className="space-y-4">
      {/* === ОСНОВНОЕ === */}
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Основное</div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="lesson-title">Название *</Label>
          <Input
            id="lesson-title"
            value={formData.title}
            onChange={(e) => {
              const newTitle = e.target.value;
              onFormDataChange(prev => ({
                ...prev,
                title: newTitle,
                slug: editingLesson ? prev.slug : generateSlug(newTitle),
              }));
            }}
            placeholder="Введение в тему"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lesson-slug">URL-slug *</Label>
          <Input
            id="lesson-slug"
            value={formData.slug}
            onChange={(e) => onFormDataChange(prev => ({ ...prev, slug: e.target.value }))}
            placeholder="vvedenie-v-temu"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lesson-description">Краткое описание</Label>
        <Textarea
          id="lesson-description"
          value={formData.description}
          onChange={(e) => onFormDataChange(prev => ({ ...prev, description: e.target.value }))}
          placeholder="О чём этот урок..."
          rows={2}
        />
      </div>

      {/* === ПУБЛИКАЦИЯ === */}
      <div className="border-t pt-4 mt-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Публикация</div>
        <div className="flex flex-wrap items-end gap-2">
          {/* Date picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">Дата</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[140px] justify-start text-left font-normal h-9"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {publishDate ? format(publishDate, "dd.MM.yyyy") : <span className="text-muted-foreground">Выбрать</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={publishDate}
                  onSelect={setPublishDate}
                  locale={ru}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time input */}
          <div className="space-y-1.5">
            <Label className="text-xs">Время</Label>
            <Input
              type="time"
              value={publishTime}
              onChange={(e) => setPublishTime(e.target.value)}
              className="w-[100px] h-9"
            />
          </div>

          {/* Timezone */}
          <div className="space-y-1.5">
            <Label className="text-xs">Часовой пояс</Label>
            <TimezoneSelector
              value={publishTimezone}
              onValueChange={setPublishTimezone}
            />
          </div>

          {/* Clear button */}
          {publishDate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPublishDate(undefined)}
              className="h-9 text-xs text-muted-foreground"
            >
              Очистить
            </Button>
          )}
        </div>
        {publishDate && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Урок будет показан со статусом «Скоро» до указанной даты
          </p>
        )}
      </div>


      {/* === ПРОХОЖДЕНИЕ === */}
      <div className="border-t pt-4 mt-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Прохождение</div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Режим завершения урока</Label>
            <Select
              value={formData.completion_mode || "manual"}
              onValueChange={(value) => onFormDataChange(prev => ({ ...prev, completion_mode: value as CompletionMode }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {completionModeOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="lesson-require_previous"
              checked={formData.require_previous || false}
              onCheckedChange={(checked) => onFormDataChange(prev => ({ ...prev, require_previous: checked }))}
            />
            <Label htmlFor="lesson-require_previous" className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              Заблокировать, пока не пройден предыдущий урок
            </Label>
          </div>
        </div>
      </div>

      {/* === ПРЕВЬЮ === */}
      <div className="border-t pt-4 mt-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Превью</div>
      <LessonThumbnailEditor
        lessonId={editingLesson?.id || "new"}
        lessonTitle={formData.title}
        lessonDescription={formData.description}
        currentThumbnail={formData.thumbnail_url || null}
        onThumbnailChange={(url) => onFormDataChange(prev => ({ ...prev, thumbnail_url: url || undefined }))}
      />
      </div>

      <Alert className="border-primary/30 bg-primary/5">
        <Blocks className="h-4 w-4 text-primary" />
        <AlertDescription className="ml-2">
          Видео, текст и другой контент добавляются через кнопку «Контент» после создания урока
        </AlertDescription>
      </Alert>

      <div className="flex items-center space-x-2">
        <Switch
          id="lesson-is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => onFormDataChange(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="lesson-is_active">Активен</Label>
      </div>
    </div>
  );
});

export default function AdminTrainingLessons() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();
  
  const [editingLesson, setEditingLesson] = useState<TrainingLesson | null>(null);
  const [editingModule, setEditingModule] = useState<any | null>(null);
  const [moduleFormData, setModuleFormData] = useState({
    title: "",
    slug: "",
    description: "",
    is_active: true,
  });
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [copyMoveTarget, setCopyMoveTarget] = useState<{
    type: "module" | "lesson";
    id: string;
    title: string;
  } | null>(null);
  
  // Date/time state for publish scheduling
  const [publishDate, setPublishDate] = useState<Date | undefined>();
  const [publishTime, setPublishTime] = useState("12:00");
  const [publishTimezone, setPublishTimezone] = useState("Europe/Minsk");
  
  const [formData, setFormData] = useState<TrainingLessonFormData>({
    module_id: moduleId || "",
    title: "",
    slug: "",
    description: "",
    content: "",
    content_type: "article",
    video_url: "",
    audio_url: "",
    duration_minutes: undefined,
    is_active: true,
    completion_mode: "manual",
    require_previous: false,
  });

  // Fetch module info
  const { data: module, isLoading: moduleLoading } = useQuery({
    queryKey: ["training-module-admin", moduleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("*")
        .eq("id", moduleId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!moduleId,
  });

  // Fetch child modules (sub-modules of current module)
  const { data: childModules = [], refetch: refetchChildModules } = useQuery({
    queryKey: ["child-modules", moduleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("*")
        .eq("parent_module_id", moduleId!)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!moduleId,
  });

  const { lessons, loading, createLesson, updateLesson, deleteLesson, reorderLessons } = useTrainingLessons(moduleId);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // Local state for sortable child modules
  const [sortedChildModules, setSortedChildModules] = useState(childModules);
  useEffect(() => { setSortedChildModules(childModules); }, [childModules]);

  const handleChildModuleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !moduleId) return;

    const oldIndex = sortedChildModules.findIndex(m => m.id === active.id);
    const newIndex = sortedChildModules.findIndex(m => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedChildModules, oldIndex, newIndex);
    setSortedChildModules(reordered);

    try {
      const updates = reordered.map((m, i) =>
        supabase.from("training_modules")
          .update({ sort_order: i * 10 })
          .eq("id", m.id)
          .eq("parent_module_id", moduleId)
      );
      const results = await Promise.all(updates);
      const failed = results.filter(r => r.error);
      if (failed.length > 0) {
        toast.error("Ошибка сохранения порядка модулей");
        refetchChildModules();
      }
    } catch {
      toast.error("Ошибка сохранения порядка модулей");
      refetchChildModules();
    }
  }, [sortedChildModules, moduleId, refetchChildModules]);

  const handleLessonDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = lessons.findIndex(l => l.id === active.id);
    const newIndex = lessons.findIndex(l => l.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(lessons, oldIndex, newIndex);
    await reorderLessons(reordered.map(l => l.id));
  }, [lessons, reorderLessons]);

  const resetForm = useCallback(() => {
    setFormData({
      module_id: moduleId || "",
      title: "",
      slug: "",
      description: "",
      content: "",
      content_type: "article",
      video_url: "",
      audio_url: "",
      thumbnail_url: "",
      duration_minutes: undefined,
      is_active: true,
      completion_mode: "manual",
      require_previous: false,
    });
    setPublishDate(undefined);
    setPublishTime("12:00");
    setPublishTimezone("Europe/Minsk");
  }, [moduleId]);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setIsCreateDialogOpen(true);
  }, [resetForm]);

  const openEditDialog = useCallback((lesson: TrainingLesson) => {
    setEditingLesson(lesson);
    
    // Parse published_at into separate fields - IN SELECTED TIMEZONE
    // PATCH: Use formatInTimeZone to show correct time in Minsk timezone
    let parsedDate: Date | undefined;
    let parsedTime = "12:00";
    const tz = "Europe/Minsk"; // Default timezone for editing
    
    if (lesson.published_at) {
      try {
        const utcDate = parseISO(lesson.published_at);
        parsedDate = utcDate; // Store the UTC date
        // Format time IN THE SELECTED TIMEZONE (not browser local time)
        parsedTime = formatInTimeZone(utcDate, tz, "HH:mm");
      } catch {}
    }
    setPublishDate(parsedDate);
    setPublishTime(parsedTime);
    setPublishTimezone(tz); // Set timezone to Minsk
    
    setFormData({
      module_id: lesson.module_id,
      title: lesson.title,
      slug: lesson.slug,
      description: lesson.description || "",
      content: lesson.content || "",
      content_type: lesson.content_type,
      video_url: lesson.video_url || "",
      audio_url: lesson.audio_url || "",
      thumbnail_url: lesson.thumbnail_url || "",
      duration_minutes: lesson.duration_minutes || undefined,
      is_active: lesson.is_active,
      content_month: (lesson as any).content_month ?? null,
      completion_mode: lesson.completion_mode || "manual",
      require_previous: lesson.require_previous || false,
    });
  }, []);

  const openModuleEditDialog = useCallback((moduleRow: any) => {
    setEditingModule(moduleRow);
    setModuleFormData({
      title: moduleRow.title || "",
      slug: moduleRow.slug || "",
      description: moduleRow.description || "",
      is_active: moduleRow.is_active !== false,
    });
  }, []);

  const handleModuleUpdate = useCallback(async () => {
    if (!editingModule || !moduleFormData.title || !moduleFormData.slug) return;
    const { error } = await supabase
      .from("training_modules")
      .update({
        title: moduleFormData.title,
        slug: moduleFormData.slug,
        description: moduleFormData.description || null,
        is_active: moduleFormData.is_active,
      })
      .eq("id", editingModule.id);

    if (error) {
      toast.error("Ошибка обновления модуля");
      return;
    }

    toast.success("Модуль обновлён");
    setEditingModule(null);
    refetchChildModules();
    window.location.reload();
  }, [editingModule, moduleFormData, refetchChildModules]);

  const handleCreate = useCallback(async () => {
    if (!formData.title || !formData.slug || !moduleId) return;
    
    // PATCH-E: Build published_at as wall-clock time in selected timezone
    // Using TZ database offset calculation instead of local time interpretation
    let publishedAt: string | null = null;
    if (publishDate) {
      // Validate time format
      if (!/^\d{2}:\d{2}$/.test(publishTime)) {
        toast.error("Неверный формат времени (HH:mm)");
        return;
      }
      // PATCH-3: Build wall-clock date and interpret in selected timezone
      const dateStr = format(publishDate, "yyyy-MM-dd");
      // Create a Date object treating the input as wall-clock time in the selected TZ
      const wallClockDate = new Date(`${dateStr}T${publishTime}:00`);
      // fromZonedTime interprets wallClockDate as if it's in publishTimezone and returns UTC
      const utcDate = fromZonedTime(wallClockDate, publishTimezone);
      publishedAt = utcDate.toISOString();
    }
    
    const success = await createLesson({
      ...formData,
      module_id: moduleId,
      sort_order: lessons.length,
      published_at: publishedAt || undefined,
    });
    if (success) {
      setIsCreateDialogOpen(false);
      resetForm();
    }
  }, [formData, moduleId, lessons.length, createLesson, resetForm, publishDate, publishTime, publishTimezone]);

  const handleUpdate = useCallback(async () => {
    if (!editingLesson || !formData.title || !formData.slug) return;
    
    // PATCH-E: Build published_at as wall-clock time in selected timezone
    let publishedAt: string | null = null;
    if (publishDate) {
      // Validate time format
      if (!/^\d{2}:\d{2}$/.test(publishTime)) {
        toast.error("Неверный формат времени (HH:mm)");
        return;
      }
      // PATCH-3: Build wall-clock date and interpret in selected timezone
      const dateStr = format(publishDate, "yyyy-MM-dd");
      const wallClockDate = new Date(`${dateStr}T${publishTime}:00`);
      const utcDate = fromZonedTime(wallClockDate, publishTimezone);
      publishedAt = utcDate.toISOString();
    }
    
    const success = await updateLesson(editingLesson.id, {
      ...formData,
      published_at: publishedAt || undefined,
    });
    if (success) {
      setEditingLesson(null);
      resetForm();
    }
  }, [editingLesson, formData, updateLesson, resetForm, publishDate, publishTime, publishTimezone]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirmId) return;
    
    const success = await deleteLesson(deleteConfirmId);
    if (success) {
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, deleteLesson]);

  // Stable callback for form data changes
  const handleFormDataChange = useCallback((updater: (prev: TrainingLessonFormData) => TrainingLessonFormData) => {
    setFormData(updater);
  }, []);

  if (moduleLoading) {
    return (
      <AdminLayout>
        <div className="container mx-auto px-4 py-6 max-w-6xl">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-24 w-full mb-4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AdminLayout>
    );
  }

  if (!module) {
    return (
      <AdminLayout>
        <div className="container mx-auto px-4 py-6 max-w-6xl text-center">
          <h1 className="text-2xl font-bold mb-4">Модуль не найден</h1>
          <Button onClick={() => navigate("/admin/training-modules")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            К списку модулей
          </Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/admin/training-modules" className="hover:text-foreground transition-colors">
            Тренинги
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">{module.title}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{module.title}</h1>
            <p className="text-muted-foreground">Управление уроками модуля</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => navigate("/admin/training-modules")}
              className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border border-border bg-background hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Назад</span>
            </button>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border border-border bg-background hover:bg-muted transition-colors"
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Добавить модуль</span>
            </button>
            <button
              onClick={openCreateDialog}
              className="flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Добавить урок</span>
            </button>
          </div>
        </div>

        {/* Child Modules */}
        {sortedChildModules.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Дочерние модули</h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleChildModuleDragEnd}>
              <SortableContext items={sortedChildModules.map(m => m.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {sortedChildModules.map((child) => (
                    <SortableItem key={child.id} id={child.id}>
                      <Card
                        className="cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => navigate(`/admin/training-modules/${child.id}/lessons`)}
                      >
                        <CardContent className="flex items-center gap-3 p-4">
                          <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Layers className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{child.title}</h4>
                            <code className="text-xs text-muted-foreground">/{child.slug}</code>
                          </div>
                          <Badge variant={child.is_active ? "default" : "secondary"} className="shrink-0">
                            {child.is_active ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                            <span className="hidden sm:inline">{child.is_active ? "Активен" : "Скрыт"}</span>
                          </Badge>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Копировать / Переместить"
                              onClick={() => setCopyMoveTarget({ type: "module", id: child.id, title: child.title })}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Редактировать модуль"
                              onClick={() => openModuleEditDialog(child)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                if (!confirm(`Удалить модуль "${child.title}"?`)) return;
                                const { error } = await supabase
                                  .from("training_modules")
                                  .delete()
                                  .eq("id", child.id);
                                if (error) {
                                  toast.error("Ошибка удаления модуля");
                                } else {
                                  toast.success("Модуль удалён");
                                  refetchChildModules();
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        </CardContent>
                      </Card>
                    </SortableItem>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Lessons List */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : lessons.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Уроки не созданы</h3>
              <p className="text-muted-foreground mb-4">
                Добавьте первый урок в этот модуль
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Создать урок
              </Button>
            </CardContent>
          </Card>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleLessonDragEnd}>
            <SortableContext items={lessons.map(l => l.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {lessons.map((lesson, index) => {
                  const typeOpt = contentTypeOptions.find(o => o.value === lesson.content_type);
                  const TypeIcon = typeOpt?.icon || BookOpen;

                  return (
                    <SortableItem key={lesson.id} id={lesson.id}>
                      <Card>
                        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4">
                          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                            {/* Order number */}
                            <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                              {index + 1}
                            </div>

                            {/* Type icon */}
                            <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0 hidden sm:block" />

                            {/* Lesson info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium truncate">{lesson.title}</h3>
                                <Badge variant={lesson.is_active ? "default" : "secondary"} className="shrink-0">
                                  {lesson.is_active ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                                  <span className="hidden sm:inline">{lesson.is_active ? "Активен" : "Скрыт"}</span>
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-muted-foreground">
                                <code className="bg-muted px-1.5 py-0.5 rounded text-xs truncate max-w-[120px] sm:max-w-none">
                                  {lesson.slug}
                                </code>
                                {lesson.duration_minutes && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {lesson.duration_minutes} мин
                                  </span>
                                )}
                                <span className="hidden sm:inline">{typeOpt?.label}</span>
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-11 sm:ml-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Копировать / Переместить"
                              onClick={() => setCopyMoveTarget({ type: "lesson", id: lesson.id, title: lesson.title })}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            {lesson.completion_mode === 'kvest' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/admin/training-lessons/${moduleId}/progress/${lesson.id}`)}
                              >
                                <Users className="h-4 w-4 sm:mr-1" />
                                <span className="hidden sm:inline">Прогресс</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/admin/training-lessons/${moduleId}/edit/${lesson.id}`)}
                            >
                              <Blocks className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">Контент</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(lesson)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteConfirmId(lesson.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </SortableItem>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Create Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Новый урок</DialogTitle>
              <DialogDescription>
                Создайте новый урок в модуле "{module.title}"
              </DialogDescription>
            </DialogHeader>
            <LessonFormContent 
              formData={formData}
              onFormDataChange={handleFormDataChange}
              editingLesson={null}
              publishDate={publishDate}
              setPublishDate={setPublishDate}
              publishTime={publishTime}
              setPublishTime={setPublishTime}
              publishTimezone={publishTimezone}
              setPublishTimezone={setPublishTimezone}
            />
            <DialogFooter className="sticky bottom-0 bg-background pt-4 pb-[env(safe-area-inset-bottom)]">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleCreate} disabled={!formData.title || !formData.slug}>
                Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editingLesson} onOpenChange={(open) => !open && setEditingLesson(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Редактирование урока</DialogTitle>
              <DialogDescription>
                Измените параметры урока
              </DialogDescription>
            </DialogHeader>
            <LessonFormContent 
              formData={formData}
              onFormDataChange={handleFormDataChange}
              editingLesson={editingLesson}
              publishDate={publishDate}
              setPublishDate={setPublishDate}
              publishTime={publishTime}
              setPublishTime={setPublishTime}
              publishTimezone={publishTimezone}
              setPublishTimezone={setPublishTimezone}
            />
            <DialogFooter className="sticky bottom-0 bg-background pt-4 pb-[env(safe-area-inset-bottom)]">
              <Button variant="outline" onClick={() => setEditingLesson(null)}>
                Отмена
              </Button>
              <Button onClick={handleUpdate} disabled={!formData.title || !formData.slug}>
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit child module Dialog */}
        <Dialog open={!!editingModule} onOpenChange={(open) => !open && setEditingModule(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Редактирование модуля</DialogTitle>
              <DialogDescription>
                Измените название, адрес и видимость папки
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="module-title">Название *</Label>
                  <Input
                    id="module-title"
                    value={moduleFormData.title}
                    onChange={(e) => setModuleFormData((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Название модуля"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="module-slug">URL-slug *</Label>
                  <Input
                    id="module-slug"
                    value={moduleFormData.slug}
                    onChange={(e) => setModuleFormData((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder="url-modulya"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="module-description">Описание</Label>
                <Textarea
                  id="module-description"
                  value={moduleFormData.description}
                  onChange={(e) => setModuleFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Краткое описание модуля"
                  rows={3}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="module-is-active"
                  checked={moduleFormData.is_active}
                  onCheckedChange={(checked) => setModuleFormData((prev) => ({ ...prev, is_active: checked }))}
                />
                <Label htmlFor="module-is-active">Активен</Label>
              </div>
            </div>
            <DialogFooter className="sticky bottom-0 bg-background pt-4 pb-[env(safe-area-inset-bottom)]">
              <Button variant="outline" onClick={() => setEditingModule(null)}>
                Отмена
              </Button>
              <Button onClick={handleModuleUpdate} disabled={!moduleFormData.title || !moduleFormData.slug}>
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm Dialog */}
        <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить урок?</AlertDialogTitle>
              <AlertDialogDescription>
                Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ContentCreationWizard для создания нового модуля в том же разделе */}
      <ContentCreationWizard
        open={isWizardOpen}
        onOpenChange={setIsWizardOpen}
        initialSectionKey={module?.menu_section_key || "products-library"}
        initialParentModuleId={module?.id}
      />

      {/* Copy/Move Dialog */}
      {copyMoveTarget && (
        <CopyMoveDialog
          open={!!copyMoveTarget}
          onOpenChange={(open) => !open && setCopyMoveTarget(null)}
          sourceType={copyMoveTarget.type}
          sourceId={copyMoveTarget.id}
          sourceTitle={copyMoveTarget.title}
          currentSectionKey={module?.menu_section_key || "products-library"}
          onSuccess={() => {
            refetchChildModules();
            // refetch lessons via hook
            window.location.reload();
          }}
        />
      )}
    </AdminLayout>
  );
}
