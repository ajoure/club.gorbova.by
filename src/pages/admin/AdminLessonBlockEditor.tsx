import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { LessonBlockEditor } from "@/components/admin/lesson-editor/LessonBlockEditor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BookOpen, Eye } from "lucide-react";

export default function AdminLessonBlockEditor() {
  const { moduleId, lessonId } = useParams<{ moduleId: string; lessonId: string }>();
  const navigate = useNavigate();

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
        <div className="flex items-center justify-between mb-6">
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
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => navigate(`/admin/training-modules/${moduleId}/lessons`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Назад
            </Button>
            <Button 
              variant="outline"
              onClick={() => window.open(`/library/${module.slug}/${lesson.slug}`, '_blank')}
            >
              <Eye className="mr-2 h-4 w-4" />
              Просмотр
            </Button>
          </div>
        </div>

        {/* Block Editor */}
        <div className="bg-card border rounded-lg p-6">
          <LessonBlockEditor lessonId={lessonId!} />
        </div>
      </div>
    </AdminLayout>
  );
}
