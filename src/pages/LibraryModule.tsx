import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useTrainingLessons, TrainingLesson } from "@/hooks/useTrainingLessons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  BookOpen,
  Video,
  FileText,
  Music,
  Files,
  Clock,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

const contentTypeConfig = {
  video: { icon: Video, label: "Видео", color: "text-blue-500" },
  audio: { icon: Music, label: "Аудио", color: "text-purple-500" },
  article: { icon: FileText, label: "Статья", color: "text-green-500" },
  document: { icon: Files, label: "Документ", color: "text-orange-500" },
  mixed: { icon: BookOpen, label: "Материал", color: "text-pink-500" },
};

export default function LibraryModule() {
  const { moduleSlug } = useParams<{ moduleSlug: string }>();
  const navigate = useNavigate();

  // Fetch module info
  const { data: module, isLoading: moduleLoading } = useQuery({
    queryKey: ["training-module", moduleSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("*")
        .eq("slug", moduleSlug)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!moduleSlug,
  });

  const { lessons, loading: lessonsLoading, markCompleted, markIncomplete } = useTrainingLessons(module?.id);

  const handleLessonClick = (lesson: TrainingLesson) => {
    navigate(`/library/${moduleSlug}/${lesson.slug}`);
  };

  const handleToggleComplete = async (lesson: TrainingLesson, e: React.MouseEvent) => {
    e.stopPropagation();
    if (lesson.is_completed) {
      await markIncomplete(lesson.id);
    } else {
      await markCompleted(lesson.id);
    }
  };

  const completedCount = lessons.filter(l => l.is_completed).length;
  const progress = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;

  if (moduleLoading) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-32 w-full mb-6" />
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!module) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl text-center">
          <h1 className="text-2xl font-bold mb-4">Модуль не найден</h1>
          <Button onClick={() => navigate("/library")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Вернуться в библиотеку
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/library" className="hover:text-foreground transition-colors">
            База знаний
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">{module.title}</span>
        </div>

        {/* Module Header */}
        <Card className={`mb-8 overflow-hidden bg-gradient-to-br ${module.color_gradient || "from-pink-500 to-fuchsia-600"}`}>
          <CardHeader className="text-white">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl mb-2">{module.title}</CardTitle>
                {module.description && (
                  <CardDescription className="text-white/80">
                    {module.description}
                  </CardDescription>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/library")}
                className="shrink-0"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Назад
              </Button>
            </div>
          </CardHeader>
          <CardContent className="text-white">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                <span>{lessons.length} уроков</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                <span>Пройдено: {completedCount} из {lessons.length} ({progress}%)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lessons List */}
        {lessonsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : lessons.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Уроки пока не добавлены</h3>
              <p className="text-muted-foreground">
                Материалы скоро появятся
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {lessons.filter(l => l.is_active).map((lesson, index) => {
              const config = contentTypeConfig[lesson.content_type];
              const Icon = config.icon;

              return (
                <Card
                  key={lesson.id}
                  className={`cursor-pointer transition-all hover:shadow-md group ${
                    lesson.is_completed ? "bg-muted/30" : ""
                  }`}
                  onClick={() => handleLessonClick(lesson)}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Completion checkbox */}
                    <div
                      className="shrink-0"
                      onClick={(e) => handleToggleComplete(lesson, e)}
                    >
                      <Checkbox
                        checked={lesson.is_completed}
                        className="h-6 w-6 rounded-full"
                      />
                    </div>

                    {/* Lesson number */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </div>

                    {/* Content type icon */}
                    <div className={`shrink-0 ${config.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>

                    {/* Lesson info */}
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-medium group-hover:text-primary transition-colors ${
                        lesson.is_completed ? "text-muted-foreground line-through" : ""
                      }`}>
                        {lesson.title}
                      </h3>
                      {lesson.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {lesson.description}
                        </p>
                      )}
                    </div>

                    {/* Duration */}
                    {lesson.duration_minutes && (
                      <div className="shrink-0 flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>{lesson.duration_minutes} мин</span>
                      </div>
                    )}

                    {/* Badge */}
                    <Badge variant="secondary" className="shrink-0">
                      {config.label}
                    </Badge>

                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
