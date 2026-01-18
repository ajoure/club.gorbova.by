import { useNavigate, useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Download, CheckCircle2, Lock, Play } from "lucide-react";
import { useQuestLesson } from "@/hooks/useQuests";
import { useState, useEffect } from "react";

export default function QuestLesson() {
  const navigate = useNavigate();
  const { questSlug, lessonSlug } = useParams<{ questSlug: string; lessonSlug: string }>();
  const { data, isLoading, error, markComplete } = useQuestLesson(questSlug || "", lessonSlug || "");
  const [homeworkChecked, setHomeworkChecked] = useState(false);
  const [embedCode, setEmbedCode] = useState<string | null>(null);
  const [embedLoading, setEmbedLoading] = useState(false);

  // Fetch embed code for video
  useEffect(() => {
    const fetchEmbedCode = async () => {
      if (!data?.lesson?.video_id) return;
      
      setEmbedLoading(true);
      try {
        // Call kinescope-api edge function
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kinescope-api`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${(await import("@/integrations/supabase/client")).supabase.auth.getSession().then(s => s.data.session?.access_token)}`,
          },
          body: JSON.stringify({
            action: "get_embed_code",
            video_id: data.lesson.video_id,
          }),
        });
        
        const result = await response.json();
        if (result.embed_code) {
          setEmbedCode(result.embed_code);
        }
      } catch (err) {
        console.error("Failed to fetch embed code:", err);
      } finally {
        setEmbedLoading(false);
      }
    };

    fetchEmbedCode();
  }, [data?.lesson?.video_id]);

  useEffect(() => {
    if (data?.lesson?.isCompleted) {
      setHomeworkChecked(true);
    }
  }, [data?.lesson?.isCompleted]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="aspect-video" />
          <Skeleton className="h-48" />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto text-center py-12">
          <p className="text-destructive">Урок не найден</p>
          <Button
            variant="outline"
            onClick={() => navigate(`/self-development/quests/${questSlug}`)}
            className="mt-4"
          >
            Вернуться к урокам
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const { quest, lesson, currentIndex, totalLessons, prevLesson, nextLesson } = data;

  // Check if lesson is accessible
  if (!lesson.isAccessible && !lesson.isCompleted) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Урок заблокирован</h2>
          <p className="text-muted-foreground mb-4">
            Пройдите предыдущий урок, чтобы разблокировать этот
          </p>
          <Button onClick={() => navigate(`/self-development/quests/${questSlug}`)}>
            Вернуться к урокам
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const handleMarkComplete = async () => {
    await markComplete.mutateAsync();
    if (nextLesson) {
      navigate(`/self-development/quests/${questSlug}/${nextLesson.slug}`);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/self-development/quests/${questSlug}`)}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              {quest.title} • Урок {currentIndex + 1} из {totalLessons}
            </p>
            <h1 className="text-2xl font-bold text-foreground">{lesson.title}</h1>
          </div>
          {lesson.isCompleted && (
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-sm font-medium">Пройден</span>
            </div>
          )}
        </div>

        {/* Video Player */}
        <Card className="overflow-hidden border-0 shadow-lg">
          <CardContent className="p-0">
            {lesson.video_id ? (
              <div className="aspect-video bg-muted relative">
                {embedLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
                  </div>
                ) : embedCode ? (
                  <div 
                    className="w-full h-full"
                    dangerouslySetInnerHTML={{ __html: embedCode }}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                    <Play className="w-12 h-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Видео недоступно</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-video bg-muted flex items-center justify-center flex-col gap-2">
                <Play className="w-12 h-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Видео будет добавлено позже</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Homework */}
        {(lesson.homework_text || lesson.homework_file_url) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="w-5 h-5 text-primary" />
                Домашнее задание
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {lesson.homework_text && (
                <div className="prose prose-sm max-w-none text-foreground">
                  <p className="whitespace-pre-wrap">{lesson.homework_text}</p>
                </div>
              )}
              
              {lesson.homework_file_url && (
                <Button variant="outline" asChild>
                  <a href={lesson.homework_file_url} download target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" />
                    Скачать материалы
                  </a>
                </Button>
              )}

              <div className="border-t pt-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={homeworkChecked}
                    onCheckedChange={(checked) => setHomeworkChecked(!!checked)}
                    disabled={lesson.isCompleted}
                  />
                  <span className="text-sm font-medium">
                    Я выполнил(а) домашнее задание
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Complete Button */}
        {!lesson.isCompleted && (
          <Button
            size="lg"
            className="w-full"
            onClick={handleMarkComplete}
            disabled={!homeworkChecked || markComplete.isPending}
          >
            {markComplete.isPending ? (
              "Сохранение..."
            ) : nextLesson ? (
              <>Отметить пройденным и перейти к следующему</>
            ) : (
              <>Завершить квест</>
            )}
          </Button>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          {prevLesson ? (
            <Button
              variant="ghost"
              onClick={() => navigate(`/self-development/quests/${questSlug}/${prevLesson.slug}`)}
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              {prevLesson.title}
            </Button>
          ) : (
            <div />
          )}
          
          {nextLesson ? (
            <Button
              variant="ghost"
              onClick={() => navigate(`/self-development/quests/${questSlug}/${nextLesson.slug}`)}
              disabled={!lesson.isCompleted}
            >
              {nextLesson.title}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => navigate(`/self-development/quests/${questSlug}`)}
            >
              К списку уроков
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
