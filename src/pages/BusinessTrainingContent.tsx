import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramLinkStatus, useStartTelegramLink } from "@/hooks/useTelegramLink";
import { 
  Calendar, 
  Lock, 
  Play, 
  Check, 
  Clock, 
  MessageCircle,
  Bell,
  ExternalLink,
  Loader2,
  ArrowLeft
} from "lucide-react";

// Mock lessons for the training
const trainingLessons = [
  { id: 1, title: "Урок 1: Анализ своих компетенций", status: "locked", date: "5 февраля 2026" },
  { id: 2, title: "Урок 2: Исследование рынка", status: "locked", date: "12 февраля 2026" },
  { id: 3, title: "Урок 3: Позиционирование услуг", status: "locked", date: "19 февраля 2026" },
  { id: 4, title: "Урок 4: Ценообразование", status: "locked", date: "26 февраля 2026" },
  { id: 5, title: "Урок 5: Первые клиенты", status: "locked", date: "5 марта 2026" },
  { id: 6, title: "Урок 6: Юридические аспекты", status: "locked", date: "12 марта 2026" },
  { id: 7, title: "Урок 7: Маркетинг и продвижение", status: "locked", date: "19 марта 2026" },
  { id: 8, title: "Урок 8: Автоматизация процессов", status: "locked", date: "26 марта 2026" },
  { id: 9, title: "Урок 9: Масштабирование бизнеса", status: "locked", date: "2 апреля 2026" },
  { id: 10, title: "Урок 10: Работа с командой", status: "locked", date: "9 апреля 2026" },
  { id: 11, title: "Урок 11: Финансовое планирование", status: "locked", date: "16 апреля 2026" },
  { id: 12, title: "Урок 12: Итоги и следующие шаги", status: "locked", date: "23 апреля 2026" },
];

export default function BusinessTrainingContent() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: telegramStatus } = useTelegramLinkStatus();
  const startTelegramLink = useStartTelegramLink();

  // Check access
  const { data: accessData, isLoading: accessLoading } = useQuery({
    queryKey: ["buh-business-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return { hasAccess: false, type: null };
      
      // Check preregistration
      const { data: preregistration } = await supabase
        .from("course_preregistrations")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .in("status", ["new", "contacted"])
        .maybeSingle();
      
      // Check entitlements
      const { data: entitlement } = await supabase
        .from("entitlements")
        .select("id, status, expires_at")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .eq("status", "active")
        .maybeSingle();
      
      if (entitlement) {
        return { hasAccess: true, type: "active" as const, expiresAt: entitlement.expires_at };
      }
      if (preregistration) {
        return { hasAccess: true, type: "preregistration" as const };
      }
      return { hasAccess: false, type: null };
    },
    enabled: !!user?.id,
  });

  const handleStartTelegramLink = async () => {
    try {
      const result = await startTelegramLink.mutateAsync();
      if (result.deep_link) {
        window.open(result.deep_link, "_blank");
      }
    } catch (error) {
      console.error("Error starting telegram link:", error);
    }
  };

  // Loading state
  if (authLoading || accessLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  // No access - redirect to landing
  if (!accessData?.hasAccess) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <GlassCard className="text-center py-12">
            <Lock className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Доступ закрыт</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Для доступа к тренингу необходимо забронировать место
            </p>
            <Button onClick={() => navigate("/business-training")}>
              Забронировать место
            </Button>
          </GlassCard>
        </div>
      </DashboardLayout>
    );
  }

  const completedCount = 0;
  const totalCount = trainingLessons.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/products?tab=library")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground">Бухгалтерия как бизнес</h1>
            <p className="text-muted-foreground">Ежемесячный тренинг с Катериной Горбовой</p>
          </div>
          <Badge variant="outline" className={accessData.type === "active" ? "bg-emerald-500/10 text-emerald-600 border-0" : "bg-amber-500/20 text-amber-600 border-0"}>
            {accessData.type === "active" ? (
              <><Check className="h-3 w-3 mr-1" /> Активно</>
            ) : (
              <><Clock className="h-3 w-3 mr-1" /> Бронь</>
            )}
          </Badge>
        </div>

        {/* Start Date Notification */}
        <GlassCard className="relative overflow-hidden border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-50" />
          <div className="relative p-6 flex items-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-primary/20 flex items-center justify-center">
              <Calendar className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">Старт тренинга: 5 февраля 2026</h3>
              <p className="text-sm text-muted-foreground">
                Первый урок будет доступен в день старта. Мы напомним вам за день до начала.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              <Bell className="h-4 w-4" />
              Уведомим за 1 день
            </div>
          </div>
        </GlassCard>

        {/* Telegram CTA if not linked */}
        {telegramStatus?.status !== "active" && (
          <GlassCard className="p-4 border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Привяжите Telegram для уведомлений</p>
                <p className="text-xs text-muted-foreground">
                  Получайте напоминания о новых уроках, списаниях и важных обновлениях
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleStartTelegramLink}
                disabled={startTelegramLink.isPending}
                className="border-amber-500/30 hover:bg-amber-500/10"
              >
                {startTelegramLink.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Привязать
                  </>
                )}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Progress */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Прогресс обучения</span>
            <span className="text-sm text-muted-foreground">{completedCount} из {totalCount} уроков</span>
          </div>
          <Progress value={progress} className="h-2" />
        </GlassCard>

        {/* Lessons List */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Программа тренинга</h2>
          <div className="space-y-2">
            {trainingLessons.map((lesson, index) => (
              <GlassCard 
                key={lesson.id} 
                className={`p-4 transition-all ${
                  lesson.status === "locked" 
                    ? "opacity-60" 
                    : lesson.status === "completed"
                    ? "border-emerald-500/20"
                    : "hover:border-primary/30 cursor-pointer"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                    lesson.status === "completed" 
                      ? "bg-emerald-500/20 text-emerald-600"
                      : lesson.status === "available"
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {lesson.status === "completed" ? (
                      <Check className="h-5 w-5" />
                    ) : lesson.status === "available" ? (
                      <Play className="h-5 w-5" />
                    ) : (
                      <Lock className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{lesson.title}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {lesson.date}
                    </p>
                  </div>
                  {lesson.status === "locked" && (
                    <Badge variant="outline" className="text-xs">
                      Скоро
                    </Badge>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
