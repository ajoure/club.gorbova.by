import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Compass, Target, ChevronRight, Flame, CalendarCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function SelfDevelopment() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Fetch quests with user progress
  const { data: questsData, isLoading: isLoadingQuests } = useQuery({
    queryKey: ["self-development-quests-summary", user?.id],
    queryFn: async () => {
      const { data: quests, error: questsError } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      if (questsError) throw questsError;
      if (!quests?.length) return { quests: [], totalLessons: 0, completedLessons: 0 };

      // Get user progress for all quests
      const { data: progress } = await supabase
        .from("quest_user_progress")
        .select("lesson_id, is_completed")
        .eq("user_id", user?.id || "")
        .eq("is_completed", true);

      const completedLessons = progress?.length || 0;
      const totalLessons = quests.reduce((sum, q) => sum + q.total_lessons, 0);

      return { quests, totalLessons, completedLessons };
    },
    enabled: !!user?.id,
  });

  // Fetch balance wheel last data
  const { data: balanceData, isLoading: isLoadingBalance } = useQuery({
    queryKey: ["self-development-balance-summary", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("balance_wheel_data")
        .select("value, updated_at")
        .eq("user_id", user?.id || "")
        .order("updated_at", { ascending: false })
        .limit(8);

      if (error) throw error;
      if (!data?.length) return null;

      const avgScore = data.reduce((sum, d) => sum + d.value, 0) / data.length;
      const lastUpdate = data[0]?.updated_at;

      return { avgScore, lastUpdate };
    },
    enabled: !!user?.id,
  });

  // Fetch habit challenges summary
  const { data: habitsData, isLoading: isLoadingHabits } = useQuery({
    queryKey: ["self-development-habits-summary", user?.id],
    queryFn: async () => {
      const { data: challenges, error } = await supabase
        .from("habit_challenges")
        .select("id, title, duration_days, start_date")
        .eq("user_id", user?.id || "")
        .eq("is_active", true);

      if (error) throw error;
      if (!challenges?.length) return null;

      // Get today's logs
      const today = new Date().toISOString().split("T")[0];
      const { data: todayLogs } = await supabase
        .from("habit_daily_logs")
        .select("challenge_id, is_completed")
        .eq("user_id", user?.id || "")
        .eq("log_date", today);

      const completedToday = todayLogs?.filter(l => l.is_completed).length || 0;

      return {
        activeChallenges: challenges.length,
        completedToday,
      };
    },
    enabled: !!user?.id,
  });

  const questProgress = questsData?.totalLessons
    ? Math.round((questsData.completedLessons / questsData.totalLessons) * 100)
    : 0;

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg">
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Саморазвитие</h1>
            <p className="text-muted-foreground">Личностный рост, обучение и самопознание</p>
          </div>
        </div>

        {/* Main Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Quests Card */}
          <Card 
            className="group cursor-pointer overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
            onClick={() => navigate("/self-development/quests")}
          >
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-purple-500 to-indigo-600 p-6 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <Compass className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">Квесты</h3>
                      <p className="text-white/70 text-sm">Интерактивное обучение</p>
                    </div>
                  </div>

                  <p className="text-white/80 text-sm mb-4">
                    Пошаговое обучение с видеоуроками и домашними заданиями
                  </p>

                  {isLoadingQuests ? (
                    <Skeleton className="h-16 bg-white/20" />
                  ) : questsData?.quests.length ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/70">Прогресс</span>
                        <span className="font-medium">
                          {questsData.completedLessons} из {questsData.totalLessons} уроков
                        </span>
                      </div>
                      <Progress value={questProgress} className="h-2 bg-white/20" />
                    </div>
                  ) : (
                    <p className="text-white/60 text-sm">Начните свой первый квест</p>
                  )}
                </div>
              </div>

              <div className="p-4 bg-card flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {questsData?.quests.length ? "Продолжить обучение" : "Начать обучение"}
                </span>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </div>
            </CardContent>
          </Card>

          {/* Balance Wheel Card */}
          <Card 
            className="group cursor-pointer overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
            onClick={() => navigate("/self-development/balance-wheel")}
          >
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-primary to-accent p-6 text-primary-foreground relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <Target className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">Колесо баланса</h3>
                      <p className="text-primary-foreground/70 text-sm">Оценка сфер жизни</p>
                    </div>
                  </div>

                  <p className="text-primary-foreground/80 text-sm mb-4">
                    Оцените 8 ключевых сфер жизни и найдите точки роста для гармоничного развития
                  </p>

                  {isLoadingBalance ? (
                    <Skeleton className="h-10 bg-white/20" />
                  ) : balanceData ? (
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg">
                          {balanceData.avgScore.toFixed(1)}
                        </div>
                        <span className="text-primary-foreground/70 text-sm">средний балл</span>
                      </div>
                      {balanceData.lastUpdate && (
                        <div className="text-primary-foreground/60 text-sm">
                          Обновлено: {formatDate(balanceData.lastUpdate)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-primary-foreground/60 text-sm">Пройдите первую оценку</p>
                  )}
                </div>
              </div>

              <div className="p-4 bg-card flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {balanceData ? "Обновить оценку" : "Пройти оценку"}
                </span>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </div>
            </CardContent>
          </Card>

          {/* Habit Tracker Card */}
          <Card 
            className="group cursor-pointer overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 md:col-span-2"
            onClick={() => navigate("/self-development/habits")}
          >
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
                
                <div className="relative z-10">
                  <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <CalendarCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">Трекер привычек</h3>
                        <p className="text-white/70 text-sm">Челленджи и привычки</p>
                      </div>
                    </div>

                    <div className="flex-1">
                      <p className="text-white/80 text-sm">
                        Формируйте полезные привычки с помощью интерактивных челленджей и визуального отслеживания прогресса
                      </p>
                    </div>

                    {isLoadingHabits ? (
                      <Skeleton className="h-12 w-32 bg-white/20" />
                    ) : habitsData ? (
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-2">
                          <Flame className="w-5 h-5" />
                          <div className="text-sm">
                            <div className="font-bold">{habitsData.activeChallenges}</div>
                            <div className="text-white/70 text-xs">активных</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-2">
                          <CalendarCheck className="w-5 h-5" />
                          <div className="text-sm">
                            <div className="font-bold">{habitsData.completedToday}</div>
                            <div className="text-white/70 text-xs">сегодня</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button 
                        variant="secondary" 
                        size="sm"
                        className="bg-white/20 hover:bg-white/30 text-white border-0"
                      >
                        Создать челлендж
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-card flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {habitsData?.activeChallenges ? "Открыть трекер" : "Начать первый челлендж"}
                </span>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
