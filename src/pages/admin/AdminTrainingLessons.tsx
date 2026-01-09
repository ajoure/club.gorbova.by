import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useTrainingLessons, TrainingLesson, TrainingLessonFormData } from "@/hooks/useTrainingLessons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

const contentTypeOptions = [
  { value: "article", label: "Статья", icon: FileText },
  { value: "video", label: "Видео", icon: Video },
  { value: "audio", label: "Аудио", icon: Music },
  { value: "document", label: "Документ", icon: Files },
  { value: "mixed", label: "Смешанный", icon: BookOpen },
];

export default function AdminTrainingLessons() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();
  
  const [editingLesson, setEditingLesson] = useState<TrainingLesson | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
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

  const resetForm = () => {
    setFormData({
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
    });
  };

  const openCreateDialog = () => {
    resetForm();
    setIsCreateDialogOpen(true);
  };

  const openEditDialog = (lesson: TrainingLesson) => {
    setEditingLesson(lesson);
    setFormData({
      module_id: lesson.module_id,
      title: lesson.title,
      slug: lesson.slug,
      description: lesson.description || "",
      content: lesson.content || "",
      content_type: lesson.content_type,
      video_url: lesson.video_url || "",
      audio_url: lesson.audio_url || "",
      duration_minutes: lesson.duration_minutes || undefined,
      is_active: lesson.is_active,
    });
  };

  const handleCreate = async () => {
    if (!formData.title || !formData.slug || !moduleId) return;
    
    const success = await createLesson({
      ...formData,
      module_id: moduleId,
      sort_order: lessons.length,
    });
    if (success) {
      setIsCreateDialogOpen(false);
      resetForm();
    }
  };

  const handleUpdate = async () => {
    if (!editingLesson || !formData.title || !formData.slug) return;
    
    const success = await updateLesson(editingLesson.id, formData);
    if (success) {
      setEditingLesson(null);
      resetForm();
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    
    const success = await deleteLesson(deleteConfirmId);
    if (success) {
      setDeleteConfirmId(null);
    }
  };

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

  const LessonFormContent = () => (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Название *</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => {
              setFormData(prev => ({
                ...prev,
                title: e.target.value,
                slug: editingLesson ? prev.slug : generateSlug(e.target.value),
              }));
            }}
            placeholder="Введение в тему"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">URL-slug *</Label>
          <Input
            id="slug"
            value={formData.slug}
            onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
            placeholder="vvedenie-v-temu"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="content_type">Тип контента</Label>
          <Select
            value={formData.content_type}
            onValueChange={(value: any) => setFormData(prev => ({ ...prev, content_type: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contentTypeOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <opt.icon className="h-4 w-4" />
                    {opt.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="duration">Длительность (минуты)</Label>
          <Input
            id="duration"
            type="number"
            value={formData.duration_minutes || ""}
            onChange={(e) => setFormData(prev => ({ 
              ...prev, 
              duration_minutes: e.target.value ? parseInt(e.target.value) : undefined 
            }))}
            placeholder="15"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Краткое описание</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="О чём этот урок..."
          rows={2}
        />
      </div>

      {(formData.content_type === "video" || formData.content_type === "mixed") && (
        <div className="space-y-2">
          <Label htmlFor="video_url">URL видео</Label>
          <Input
            id="video_url"
            value={formData.video_url || ""}
            onChange={(e) => setFormData(prev => ({ ...prev, video_url: e.target.value }))}
            placeholder="https://youtube.com/watch?v=... или https://vimeo.com/..."
          />
          <p className="text-xs text-muted-foreground">
            Поддерживается YouTube, Vimeo или прямая ссылка на видео
          </p>
        </div>
      )}

      {(formData.content_type === "audio" || formData.content_type === "mixed") && (
        <div className="space-y-2">
          <Label htmlFor="audio_url">URL аудио</Label>
          <Input
            id="audio_url"
            value={formData.audio_url || ""}
            onChange={(e) => setFormData(prev => ({ ...prev, audio_url: e.target.value }))}
            placeholder="https://..."
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="content">Текстовый контент (HTML)</Label>
        <Textarea
          id="content"
          value={formData.content}
          onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
          placeholder="<p>Содержимое урока...</p>"
          rows={6}
          className="font-mono text-sm"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="is_active">Активен</Label>
      </div>
    </div>
  );

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
            База знаний
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
            <LessonFormContent />
            <DialogFooter>
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
            <LessonFormContent />
            <DialogFooter>
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
