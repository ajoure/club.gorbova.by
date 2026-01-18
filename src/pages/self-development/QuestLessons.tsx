import { useNavigate, useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle2, Lock, Play, Clock } from "lucide-react";
import { useQuestLessons } from "@/hooks/useQuests";
import { cn } from "@/lib/utils";

export default function QuestLessons() {
  const navigate = useNavigate();
  const { questSlug } = useParams<{ questSlug: string }>();
  const { data, isLoading, error } = useQuestLessons(questSlug || "");

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-32" />
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="max-w-3xl mx-auto text-center py-12">
          <p className="text-destructive">Квест не найден</p>
          <Button
            variant="outline"
            onClick={() => navigate("/self-development/quests")}
            className="mt-4"
          >
            Вернуться к квестам
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const { quest, lessons, completedCount, totalCount } = data;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/self-development/quests")}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{quest.title}</h1>
            <p className="text-muted-foreground text-sm">{quest.description}</p>
          </div>
        </div>

        {/* Progress Card */}
        <Card className={`bg-gradient-to-br ${quest.color_gradient || 'from-purple-500 to-indigo-600'} border-0 text-white`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white/70 text-sm">Ваш прогресс</p>
                <p className="text-2xl font-bold">{completedCount} из {totalCount} уроков</p>
              </div>
              <div className="text-4xl font-bold text-white/30">{progress}%</div>
            </div>
            <Progress value={progress} className="h-3 bg-white/20" />
          </CardContent>
        </Card>

        {/* Lessons List */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground px-1">Уроки</h2>
          
          {lessons.map((lesson, index) => {
            const isLocked = !lesson.isAccessible && !lesson.isCompleted;
            
            return (
              <Card
                key={lesson.id}
                className={cn(
                  "transition-all duration-200",
                  isLocked 
                    ? "opacity-60 cursor-not-allowed" 
                    : "cursor-pointer hover:shadow-md hover:-translate-y-0.5"
                )}
                onClick={() => {
                  if (!isLocked) {
                    navigate(`/self-development/quests/${questSlug}/${lesson.slug}`);
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Status Icon */}
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      lesson.isCompleted 
                        ? "bg-primary text-primary-foreground" 
                        : isLocked 
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary/10 text-primary"
                    )}>
                      {lesson.isCompleted ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : isLocked ? (
                        <Lock className="w-5 h-5" />
                      ) : (
                        <Play className="w-5 h-5" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-medium">
                          Урок {index + 1}
                        </span>
                        {lesson.isCompleted && (
                          <span className="text-xs text-primary font-medium">✓ Пройден</span>
                        )}
                      </div>
                      <h3 className={cn(
                        "font-medium truncate",
                        isLocked ? "text-muted-foreground" : "text-foreground"
                      )}>
                        {lesson.title}
                      </h3>
                      {lesson.description && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {lesson.description}
                        </p>
                      )}
                    </div>

                    {/* Duration */}
                    {lesson.duration_minutes && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                        <Clock className="w-4 h-4" />
                        <span>{lesson.duration_minutes} мин</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
