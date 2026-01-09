import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useTrainingLessons, TrainingLesson } from "@/hooks/useTrainingLessons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Clock,
  ChevronRight,
  FileText,
  Video,
  Music,
  Files,
  BookOpen,
  ExternalLink,
} from "lucide-react";

const contentTypeConfig = {
  video: { icon: Video, label: "Видео", color: "text-blue-500" },
  audio: { icon: Music, label: "Аудио", color: "text-purple-500" },
  article: { icon: FileText, label: "Статья", color: "text-green-500" },
  document: { icon: Files, label: "Документ", color: "text-orange-500" },
  mixed: { icon: BookOpen, label: "Материал", color: "text-pink-500" },
};

export default function LibraryLesson() {
  const { moduleSlug, lessonSlug } = useParams<{ moduleSlug: string; lessonSlug: string }>();
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

  // Find current lesson
  const currentLesson = lessons.find(l => l.slug === lessonSlug);
  const currentIndex = lessons.findIndex(l => l.slug === lessonSlug);
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;

  const handleToggleComplete = async () => {
    if (!currentLesson) return;
    
    if (currentLesson.is_completed) {
      await markIncomplete(currentLesson.id);
    } else {
      await markCompleted(currentLesson.id);
    }
  };

  const navigateToLesson = (lesson: TrainingLesson) => {
    navigate(`/library/${moduleSlug}/${lesson.slug}`);
  };

  if (moduleLoading || lessonsLoading) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-96 w-full mb-6" />
          <Skeleton className="h-32 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (!module || !currentLesson) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl text-center">
          <h1 className="text-2xl font-bold mb-4">Урок не найден</h1>
          <Button onClick={() => navigate(`/library/${moduleSlug}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Вернуться к модулю
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const config = contentTypeConfig[currentLesson.content_type];
  const Icon = config.icon;

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6 flex-wrap">
          <Link to="/library" className="hover:text-foreground transition-colors">
            База знаний
          </Link>
          <ChevronRight className="h-4 w-4" />
          <Link to={`/library/${moduleSlug}`} className="hover:text-foreground transition-colors">
            {module.title}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">{currentLesson.title}</span>
        </div>

        {/* Lesson Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className={config.color}>
                <Icon className="h-3 w-3 mr-1" />
                {config.label}
              </Badge>
              {currentLesson.duration_minutes && (
                <Badge variant="outline">
                  <Clock className="h-3 w-3 mr-1" />
                  {currentLesson.duration_minutes} мин
                </Badge>
              )}
              {currentLesson.is_completed && (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Пройден
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold">{currentLesson.title}</h1>
            {currentLesson.description && (
              <p className="text-muted-foreground mt-2">{currentLesson.description}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/library/${moduleSlug}`)}
            className="shrink-0"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            К списку
          </Button>
        </div>

        {/* Video Player */}
        {currentLesson.video_url && (
          <Card className="mb-6 overflow-hidden">
            <div className="aspect-video bg-black">
              {currentLesson.video_url.includes("youtube.com") || currentLesson.video_url.includes("youtu.be") ? (
                <iframe
                  src={currentLesson.video_url.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : currentLesson.video_url.includes("vimeo.com") ? (
                <iframe
                  src={currentLesson.video_url.replace("vimeo.com/", "player.vimeo.com/video/")}
                  className="w-full h-full"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video
                  src={currentLesson.video_url}
                  controls
                  className="w-full h-full"
                />
              )}
            </div>
          </Card>
        )}

        {/* Audio Player */}
        {currentLesson.audio_url && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <Music className="h-8 w-8 text-purple-500" />
                <audio
                  src={currentLesson.audio_url}
                  controls
                  className="flex-1"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Text Content */}
        {currentLesson.content && (
          <Card className="mb-6">
            <CardContent className="py-6">
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: currentLesson.content }}
              />
            </CardContent>
          </Card>
        )}

        {/* Attachments */}
        {currentLesson.attachments && currentLesson.attachments.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Download className="h-5 w-5" />
                Файлы для скачивания
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {currentLesson.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted transition-colors"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{attachment.file_name}</p>
                      {attachment.file_size && (
                        <p className="text-sm text-muted-foreground">
                          {(attachment.file_size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      )}
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Complete Button */}
        <div className="flex justify-center mb-8">
          <Button
            size="lg"
            variant={currentLesson.is_completed ? "outline" : "default"}
            onClick={handleToggleComplete}
            className="min-w-48"
          >
            <CheckCircle2 className="mr-2 h-5 w-5" />
            {currentLesson.is_completed ? "Отметить как непройденный" : "Отметить как пройденный"}
          </Button>
        </div>

        <Separator className="mb-6" />

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4">
          {prevLesson ? (
            <Button
              variant="outline"
              onClick={() => navigateToLesson(prevLesson)}
              className="flex-1 max-w-xs justify-start"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              <span className="truncate">{prevLesson.title}</span>
            </Button>
          ) : (
            <div />
          )}
          
          {nextLesson ? (
            <Button
              variant="outline"
              onClick={() => navigateToLesson(nextLesson)}
              className="flex-1 max-w-xs justify-end"
            >
              <span className="truncate">{nextLesson.title}</span>
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="default"
              onClick={() => navigate(`/library/${moduleSlug}`)}
              className="flex-1 max-w-xs justify-center"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Завершить модуль
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
