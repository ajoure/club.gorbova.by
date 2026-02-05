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
} from "lucide-react";

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

      {/* === ВИДЕО === */}
      <div className="border-t pt-4 mt-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Видео</div>
        <div className="space-y-2">
          <Label htmlFor="lesson-video-url">Ссылка на видео Kinescope</Label>
          <Input
            id="lesson-video-url"
            value={formData.video_url || ""}
            onChange={(e) => onFormDataChange(prev => ({ ...prev, video_url: e.target.value }))}
            placeholder="https://kinescope.io/..."
          />
        </div>
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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
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

  const { lessons, loading, createLesson, updateLesson, deleteLesson } = useTrainingLessons(moduleId);

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
    
    // Parse published_at into separate fields
    let parsedDate: Date | undefined;
    let parsedTime = "12:00";
    if (lesson.published_at) {
      try {
        parsedDate = parseISO(lesson.published_at);
        parsedTime = format(parsedDate, "HH:mm");
      } catch {}
    }
    setPublishDate(parsedDate);
    setPublishTime(parsedTime);
    
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
      completion_mode: lesson.completion_mode || "manual",
      require_previous: lesson.require_previous || false,
    });
  }, []);

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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{module.title}</h1>
            <p className="text-muted-foreground">Управление уроками модуля</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/training-modules")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Назад
            </Button>
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить урок
            </Button>
          </div>
        </div>

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
          <div className="space-y-3">
            {lessons.map((lesson, index) => {
              const typeOpt = contentTypeOptions.find(o => o.value === lesson.content_type);
              const TypeIcon = typeOpt?.icon || BookOpen;

              return (
                <Card key={lesson.id}>
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Order number */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </div>

                    {/* Type icon */}
                    <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0" />

                    {/* Lesson info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{lesson.title}</h3>
                        <Badge variant={lesson.is_active ? "default" : "secondary"} className="shrink-0">
                          {lesson.is_active ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                          {lesson.is_active ? "Активен" : "Скрыт"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                          {lesson.slug}
                        </code>
                        {lesson.duration_minutes && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lesson.duration_minutes} мин
                          </span>
                        )}
                        <span>{typeOpt?.label}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {lesson.completion_mode === 'kvest' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/admin/training-lessons/${moduleId}/progress/${lesson.id}`)}
                        >
                          <Users className="h-4 w-4 mr-1" />
                          Прогресс
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/admin/training-lessons/${moduleId}/edit/${lesson.id}`)}
                      >
                        <Blocks className="h-4 w-4 mr-1" />
                        Контент
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
              );
            })}
          </div>
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
    </AdminLayout>
  );
}
