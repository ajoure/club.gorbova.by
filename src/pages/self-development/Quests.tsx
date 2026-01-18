import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Compass, ChevronRight, Clock, BookOpen, Lock } from "lucide-react";
import { useQuests } from "@/hooks/useQuests";

export default function Quests() {
  const navigate = useNavigate();
  const { quests, isLoading, error } = useQuests();

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/self-development")}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Compass className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Квесты</h1>
              <p className="text-muted-foreground text-sm">Интерактивное обучение с пошаговым доступом</p>
            </div>
          </div>
        </div>

        {/* Quests List */}
        <div className="space-y-4">
          {isLoading ? (
            <>
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </>
          ) : error ? (
            <Card className="p-8 text-center">
              <p className="text-destructive">Ошибка загрузки квестов</p>
            </Card>
          ) : !quests?.length ? (
            <Card className="p-12 text-center">
              <Compass className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Квесты скоро появятся</h3>
              <p className="text-muted-foreground">
                Мы готовим для вас интересные образовательные квесты
              </p>
            </Card>
          ) : (
            quests.map((quest) => {
              const progress = quest.total_lessons > 0
                ? Math.round((quest.completedLessons / quest.total_lessons) * 100)
                : 0;
              const isCompleted = quest.completedLessons === quest.total_lessons;

              return (
                <Card
                  key={quest.id}
                  className="group cursor-pointer overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                  onClick={() => navigate(`/self-development/quests/${quest.slug}`)}
                >
                  <CardContent className="p-0">
                    <div className={`bg-gradient-to-br ${quest.color_gradient || 'from-purple-500 to-indigo-600'} p-6 text-white relative overflow-hidden`}>
                      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                      
                      <div className="relative z-10">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-xl font-bold mb-1">{quest.title}</h3>
                            <div className="flex items-center gap-4 text-white/70 text-sm">
                              <span className="flex items-center gap-1">
                                <BookOpen className="w-4 h-4" />
                                {quest.total_lessons} уроков
                              </span>
                              {quest.is_free && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                                  Бесплатно
                                </span>
                              )}
                            </div>
                          </div>
                          {isCompleted && (
                            <div className="bg-white/20 rounded-full p-2">
                              <BookOpen className="w-5 h-5" />
                            </div>
                          )}
                        </div>

                        {quest.description && (
                          <p className="text-white/80 text-sm mb-4 line-clamp-2">
                            {quest.description}
                          </p>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-white/70">Прогресс</span>
                            <span className="font-medium">
                              {quest.completedLessons} из {quest.total_lessons}
                            </span>
                          </div>
                          <Progress value={progress} className="h-2 bg-white/20" />
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-card flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        {isCompleted ? (
                          <span className="text-primary font-medium">Квест завершён</span>
                        ) : quest.nextLessonSlug ? (
                          <>
                            <span className="text-foreground font-medium">Следующий урок</span>
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </>
                        ) : (
                          <span className="text-foreground font-medium">Начать квест</span>
                        )}
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Coming Soon */}
        <Card className="p-6 bg-muted/50 border-dashed">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Lock className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Эмоциональный интеллект</h3>
              <p className="text-sm text-muted-foreground">Скоро будет доступен</p>
            </div>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
