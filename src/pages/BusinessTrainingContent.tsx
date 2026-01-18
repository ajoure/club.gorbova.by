import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramLinkStatus, useStartTelegramLink } from "@/hooks/useTelegramLink";
import { toast } from "sonner";
import { 
  Calendar, 
  Lock, 
  Check, 
  Clock, 
  MessageCircle,
  Bell,
  ExternalLink,
  Loader2,
  ArrowLeft,
  BookOpen,
  Info,
  XCircle,
  CreditCard
} from "lucide-react";

const TOTAL_LESSONS = 12;

export default function BusinessTrainingContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { data: telegramStatus } = useTelegramLinkStatus();
  const startTelegramLink = useStartTelegramLink();

  // Check access
  const { data: accessData, isLoading: accessLoading } = useQuery({
    queryKey: ["buh-business-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return { hasAccess: false, type: null, preregistrationId: null };
      
      // Check preregistration
      const { data: preregistration } = await supabase
        .from("course_preregistrations")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .in("status", ["new", "contacted"])
        .maybeSingle();
      
      // Check entitlements (active)
      const { data: entitlement } = await supabase
        .from("entitlements")
        .select("id, status, expires_at")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .eq("status", "active")
        .maybeSingle();

      // Check expired entitlements
      const { data: expiredEntitlement } = await supabase
        .from("entitlements")
        .select("id, status, expires_at")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .eq("status", "expired")
        .maybeSingle();
      
      if (entitlement) {
        return { hasAccess: true, type: "active" as const, expiresAt: entitlement.expires_at, preregistrationId: null };
      }
      if (preregistration) {
        return { hasAccess: true, type: "preregistration" as const, preregistrationId: preregistration.id };
      }
      if (expiredEntitlement) {
        return { hasAccess: true, type: "expired" as const, preregistrationId: null };
      }
      return { hasAccess: false, type: null, preregistrationId: null };
    },
    enabled: !!user?.id,
  });

  // Cancel booking mutation
  const cancelBookingMutation = useMutation({
    mutationFn: async (preregistrationId: string) => {
      const { error } = await supabase
        .from("course_preregistrations")
        .update({ status: "cancelled" })
        .eq("id", preregistrationId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Бронь отменена");
      queryClient.invalidateQueries({ queryKey: ["buh-business-access"] });
      queryClient.invalidateQueries({ queryKey: ["buh-business-landing-access"] });
      navigate("/business-training");
    },
    onError: () => {
      toast.error("Не удалось отменить бронь");
    },
  });

  const handleCancelBooking = () => {
    if (accessData?.preregistrationId) {
      cancelBookingMutation.mutate(accessData.preregistrationId);
    }
  };

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
  const totalCount = TOTAL_LESSONS;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/learning")}>
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

        {/* Expired Access Warning */}
        {accessData.type === "expired" && (
          <GlassCard className="p-5 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <CreditCard className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-foreground mb-1">Ваш доступ закончился</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Чтобы продолжить обучение, продлите подписку на следующий месяц
                </p>
                <Button onClick={() => navigate("/business-training")}>
                  Продлить доступ — 250 BYN
                </Button>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Product Description */}
        <GlassCard className="p-5 border-border/50">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Info className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium mb-1">О тренинге</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Ежемесячный тренинг для бухгалтеров, которые хотят перейти из найма в собственный бизнес. 
                Вебинары с Катериной Горбовой, практические задания и нетворкинг с единомышленниками.
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="bg-muted/50">
                  <BookOpen className="h-3 w-3 mr-1" />
                  {totalCount} уроков
                </Badge>
                <Badge variant="outline" className="bg-muted/50">
                  <Clock className="h-3 w-3 mr-1" />
                  Квест
                </Badge>
                <Badge variant="outline" className="bg-muted/50">
                  <CreditCard className="h-3 w-3 mr-1" />
                  250 BYN/мес
                </Badge>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Progress */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Прогресс обучения</span>
            <span className="text-sm text-muted-foreground">{completedCount} из {totalCount} уроков</span>
          </div>
          <Progress value={progress} className="h-2" />
        </GlassCard>

        {/* Lessons List - Hidden Names */}
        <GlassCard className="p-6 text-center">
          <Lock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="font-semibold mb-2">Программа тренинга</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {totalCount} уроков — расписание и темы будут доступны после старта 5 февраля
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>Первый урок: 5 февраля 2026</span>
          </div>
        </GlassCard>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button 
            onClick={() => navigate("/business-training")}
            className="flex-1 bg-gradient-to-r from-primary/80 to-primary hover:from-primary hover:to-primary/80"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Подробнее о тренинге
          </Button>
          
          {accessData.type === "preregistration" && (
            <Button 
              variant="outline" 
              onClick={handleCancelBooking}
              disabled={cancelBookingMutation.isPending}
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              {cancelBookingMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Отменить бронь
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
