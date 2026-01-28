import { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { LessonBlockEditor } from "@/components/admin/lesson-editor/LessonBlockEditor";
import { LessonBlockRenderer } from "@/components/lesson/LessonBlockRenderer";
import { LessonThumbnailEditor } from "@/components/admin/trainings/LessonThumbnailEditor";
import { useLessonBlocks } from "@/hooks/useLessonBlocks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, BookOpen, Eye, Edit, RefreshCw, ImageIcon, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export default function AdminLessonBlockEditor() {
  const { moduleId, lessonId } = useParams<{ moduleId: string; lessonId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [previewMode, setPreviewMode] = useState(false);
  const [thumbnailOpen, setThumbnailOpen] = useState(false);
  
  // Fetch blocks for preview mode - with refetch capability
  const { blocks, loading: blocksLoading, refetch } = useLessonBlocks(lessonId);

  // Refetch blocks when switching to preview mode
  const handleTogglePreview = useCallback(async () => {
    if (!previewMode) {
      // Switching to preview - refetch blocks first
      await refetch();
    }
    setPreviewMode(!previewMode);
  }, [previewMode, refetch]);

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

  // Fetch lesson info
  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ["training-lesson-admin", lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_lessons")
        .select("*")
        .eq("id", lessonId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!lessonId,
  });

  // Handle thumbnail change
  const handleThumbnailChange = useCallback(async (url: string | null) => {
    if (!lessonId) return;
    
    try {
      const { error } = await supabase
        .from("training_lessons")
        .update({ thumbnail_url: url })
        .eq("id", lessonId);
      
      if (error) throw error;
      
      // Invalidate cache to refresh lesson data
      queryClient.invalidateQueries({ queryKey: ["training-lesson-admin", lessonId] });
      toast.success("Обложка урока обновлена");
    } catch (error: any) {
      console.error("Error updating thumbnail:", error);
      toast.error(`Ошибка сохранения: ${error.message}`);
    }
  }, [lessonId, queryClient]);

  if (moduleLoading || lessonLoading) {
    return (
      <AdminLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-6 w-48 mb-8" />
          <Skeleton className="h-12 w-full mb-4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AdminLayout>
    );
  }

  if (!module || !lesson) {
    return (
      <AdminLayout>
        <div className="container mx-auto px-4 py-12 max-w-4xl text-center">
          <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Урок не найден</h2>
          <p className="text-muted-foreground mb-4">
            Указанный урок не существует или был удалён.
          </p>
          <Button onClick={() => navigate(`/admin/training-modules/${moduleId}/lessons`)}>
            Вернуться к урокам
          </Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <span>{module.title}</span>
              <span>→</span>
              <span>{lesson.title}</span>
            </div>
            <h1 className="text-2xl font-bold">Редактор контента</h1>
            <p className="text-muted-foreground">
              Добавляйте и редактируйте блоки урока
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button 
              variant="outline" 
              onClick={() => navigate(`/admin/training-modules/${moduleId}/lessons`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Назад
            </Button>
            <Button 
              variant={previewMode ? "default" : "outline"}
              onClick={handleTogglePreview}
            >
              {previewMode ? (
                <>
                  <Edit className="mr-2 h-4 w-4" />
                  Редактирование
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Просмотр
                </>
              )}
            </Button>
            <Button 
              variant="outline"
              onClick={() => window.open(`/library/${module.slug}/${lesson.slug}`, '_blank')}
            >
              <Eye className="mr-2 h-4 w-4" />
              На сайте
            </Button>
          </div>
        </div>

        {/* Thumbnail Editor Collapsible */}
        <Collapsible open={thumbnailOpen} onOpenChange={setThumbnailOpen} className="mb-4">
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Обложка урока
                {lesson.thumbnail_url && (
                  <span className="text-xs text-muted-foreground">(установлена)</span>
                )}
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${thumbnailOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 p-4 bg-card border rounded-lg">
            <LessonThumbnailEditor
              lessonId={lessonId!}
              lessonTitle={lesson.title}
              lessonDescription={lesson.description || undefined}
              currentThumbnail={lesson.thumbnail_url}
              onThumbnailChange={handleThumbnailChange}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Block Editor or Preview */}
        <div className="bg-card border rounded-lg p-6">
          {previewMode ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              {blocksLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : blocks.length > 0 ? (
                <LessonBlockRenderer blocks={blocks} lessonId={lessonId} />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Нет блоков для отображения</p>
                  <p className="text-sm">Переключитесь в режим редактирования, чтобы добавить контент</p>
                </div>
              )}
            </div>
          ) : (
            <LessonBlockEditor lessonId={lessonId!} />
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
