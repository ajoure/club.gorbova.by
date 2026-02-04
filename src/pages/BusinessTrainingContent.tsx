import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramLinkStatus, useStartTelegramLink } from "@/hooks/useTelegramLink";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { usePublicProduct } from "@/hooks/usePublicProduct";
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
  CreditCard,
  ShoppingCart
} from "lucide-react";

const TOTAL_LESSONS = 12;

export default function BusinessTrainingContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { data: telegramStatus } = useTelegramLinkStatus();
  const startTelegramLink = useStartTelegramLink();
  
  const [paymentOpen, setPaymentOpen] = useState(false);

  // Fetch product data for payment
  const { data: productData } = usePublicProduct("business-training.gorbova.by", user?.id);

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

  // Cancel booking mutation - using edge function
  const cancelBookingMutation = useMutation({
    mutationFn: async (preregistrationId: string) => {
      const { data, error } = await supabase.functions.invoke("cancel-preregistration", {
        body: { preregistrationId },
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Бронь отменена");
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["buh-business-access", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["buh-business-landing-access", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["public-product"] });
      navigate("/business-training");
    },
    onError: (error: Error) => {
      console.error("Cancel error:", error);
      toast.error(error.message || "Не удалось отменить бронь");
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

  // Get payment offer
  const payNowOffer = productData?.tariffs?.[0]?.offers?.find(
    (o) => o.offer_type === "pay_now" && o.is_primary
  );
  const tariff = productData?.tariffs?.[0];
  const price = payNowOffer?.amount || 250;

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
          <div 
            className="text-center py-12 rounded-3xl backdrop-blur-2xl border border-border/40"
            style={{
              background: "linear-gradient(135deg, hsl(var(--card) / 0.6), hsl(var(--card) / 0.3))",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.08), inset 0 1px 0 hsl(0 0% 100% / 0.15)"
            }}
          >
            <Lock className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
            <h2 className="text-xl font-semibold mb-2 text-foreground">Доступ закрыт</h2>
            <p className="text-muted-foreground/90 mb-6 max-w-md mx-auto">
              Для доступа к тренингу необходимо забронировать место или оплатить
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button 
                onClick={() => navigate("/business-training")}
                className="bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
              >
                Забронировать место
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setPaymentOpen(true)}
                className="backdrop-blur-sm border-border/50 hover:border-primary/50 hover:bg-primary/5"
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                Оплатить сейчас — {price} BYN
              </Button>
            </div>
          </div>
        </div>
        
        {/* Payment Dialog */}
        {productData?.product && payNowOffer && tariff && (
          <PaymentDialog
            open={paymentOpen}
            onOpenChange={setPaymentOpen}
            productId={productData.product.id}
            productName={productData.product.name}
            offerId={payNowOffer.id}
            tariffCode={tariff.code}
            price={`${payNowOffer.amount} BYN`}
            isSubscription={true}
          />
        )}
      </DashboardLayout>
    );
  }

  const completedCount = 0;
  const totalCount = TOTAL_LESSONS;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 relative">
        {/* Decorative floating orbs */}
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-primary/5 blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-20 left-0 w-60 h-60 rounded-full bg-accent/5 blur-3xl pointer-events-none -z-10" />

        {/* Header */}
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate("/products")}
            className="backdrop-blur-sm hover:bg-card/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground drop-shadow-sm">Бухгалтерия как бизнес</h1>
            <p className="text-muted-foreground/90">Ежемесячный тренинг с Катериной Горбовой</p>
          </div>
          <Badge 
            variant="outline" 
            className={accessData.type === "active" 
              ? "bg-emerald-500/15 text-emerald-600 border-0 backdrop-blur-sm" 
              : "bg-amber-500/20 text-amber-600 border-0 backdrop-blur-sm"
            }
          >
            {accessData.type === "active" ? (
              <><Check className="h-3 w-3 mr-1" /> Активно</>
            ) : (
              <><Clock className="h-3 w-3 mr-1" /> Бронь</>
            )}
          </Badge>
        </div>

        {/* Start Date Notification - Enhanced glass */}
        <div 
          className="relative overflow-hidden rounded-2xl backdrop-blur-2xl border border-primary/30"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))",
            boxShadow: "0 12px 40px hsl(var(--primary) / 0.1), inset 0 1px 0 hsl(var(--primary) / 0.2)"
          }}
        >
          {/* Floating orb */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative p-6 flex items-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-primary/15 flex items-center justify-center backdrop-blur-sm">
              <Calendar className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">Старт тренинга: 5 февраля 2026</h3>
              <p className="text-sm text-muted-foreground/90">
                Первый урок будет доступен в день старта. Мы напомним вам за день до начала.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground/80">
              <Bell className="h-4 w-4" />
              Уведомим за 1 день
            </div>
          </div>
        </div>

        {/* Pay Now CTA for preregistrations */}
        {accessData.type === "preregistration" && (
          <div 
            className="relative overflow-hidden rounded-2xl backdrop-blur-2xl border border-primary/30"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary) / 0.06), hsl(var(--primary) / 0.02))",
              boxShadow: "0 8px 32px hsl(var(--primary) / 0.08), inset 0 1px 0 hsl(var(--primary) / 0.15)"
            }}
          >
            <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
            
            <div className="relative p-5 flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 backdrop-blur-sm">
                <ShoppingCart className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-foreground mb-1">Оплатите сейчас, не дожидаясь автосписания</h4>
                <p className="text-sm text-muted-foreground/90 mb-4">
                  Вы можете оплатить доступ прямо сейчас и получить полный доступ к тренингу сразу после старта
                </p>
                <Button 
                  onClick={() => setPaymentOpen(true)}
                  className="bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Оплатить — {price} BYN
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Telegram CTA if not linked */}
        {telegramStatus?.status !== "active" && (
          <div 
            className="relative overflow-hidden rounded-2xl backdrop-blur-2xl border border-amber-500/30"
            style={{
              background: "linear-gradient(135deg, hsl(45 100% 50% / 0.06), hsl(45 100% 50% / 0.02))",
              boxShadow: "0 8px 32px hsl(45 100% 50% / 0.08), inset 0 1px 0 hsl(45 100% 50% / 0.15)"
            }}
          >
            <div className="relative p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-amber-500/15 flex items-center justify-center backdrop-blur-sm">
                <MessageCircle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm text-foreground">Привяжите Telegram для уведомлений</p>
                <p className="text-xs text-muted-foreground/90">
                  Получайте напоминания о новых уроках, списаниях и важных обновлениях
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleStartTelegramLink}
                disabled={startTelegramLink.isPending}
                className="border-amber-500/30 hover:bg-amber-500/10 backdrop-blur-sm"
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
          </div>
        )}

        {/* Expired Access Warning */}
        {accessData.type === "expired" && (
          <div 
            className="relative overflow-hidden rounded-2xl backdrop-blur-2xl border border-amber-500/30"
            style={{
              background: "linear-gradient(135deg, hsl(45 100% 50% / 0.06), hsl(45 100% 50% / 0.02))",
              boxShadow: "0 8px 32px hsl(45 100% 50% / 0.08), inset 0 1px 0 hsl(45 100% 50% / 0.15)"
            }}
          >
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
            
            <div className="relative p-5 flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 backdrop-blur-sm">
                <CreditCard className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-foreground mb-1">Ваш доступ закончился</h4>
                <p className="text-sm text-muted-foreground/90 mb-4">
                  Чтобы продолжить обучение, продлите подписку на следующий месяц
                </p>
                <Button 
                  onClick={() => setPaymentOpen(true)}
                  className="bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
                >
                  Продлить доступ — {price} BYN
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Product Description */}
        <div 
          className="relative overflow-hidden rounded-2xl backdrop-blur-xl border border-border/40"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.25))",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.06), inset 0 1px 0 hsl(0 0% 100% / 0.15)"
          }}
        >
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/3 to-transparent pointer-events-none rounded-2xl" />
          
          <div className="relative p-5 flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 backdrop-blur-sm">
              <Info className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium mb-1 text-foreground">О тренинге</h4>
              <p className="text-sm text-muted-foreground/90 mb-3">
                Ежемесячный тренинг для бухгалтеров, которые хотят перейти из найма в собственный бизнес. 
                Вебинары с Катериной Горбовой, практические задания и нетворкинг с единомышленниками.
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge 
                  variant="outline" 
                  className="bg-card/40 border-border/30 backdrop-blur-sm"
                >
                  <BookOpen className="h-3 w-3 mr-1" />
                  {totalCount} уроков
                </Badge>
                <Badge 
                  variant="outline" 
                  className="bg-card/40 border-border/30 backdrop-blur-sm"
                >
                  <Clock className="h-3 w-3 mr-1" />
                  Квест
                </Badge>
                <Badge 
                  variant="outline" 
                  className="bg-card/40 border-border/30 backdrop-blur-sm"
                >
                  <CreditCard className="h-3 w-3 mr-1" />
                  {price} BYN/мес
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div 
          className="p-4 rounded-2xl backdrop-blur-xl border border-border/30"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.4), hsl(var(--card) / 0.2))",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.04), inset 0 1px 0 hsl(0 0% 100% / 0.1)"
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Прогресс обучения</span>
            <span className="text-sm text-muted-foreground/90">{completedCount} из {totalCount} уроков</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Lessons List - Hidden Names */}
        <div 
          className="p-6 text-center rounded-2xl backdrop-blur-xl border border-border/30"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.4), hsl(var(--card) / 0.2))",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.05), inset 0 1px 0 hsl(0 0% 100% / 0.1)"
          }}
        >
          <Lock className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold mb-2 text-foreground">Программа тренинга</h3>
          <p className="text-muted-foreground/90 text-sm mb-4">
            {totalCount} уроков — расписание и темы будут доступны после старта 5 февраля
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/80">
            <Calendar className="h-3 w-3" />
            <span>Первый урок: 5 февраля 2026</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button 
            onClick={() => navigate("/business-training")}
            className="flex-1 bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Подробнее о тренинге
          </Button>
          
          {accessData.type === "preregistration" && (
            <Button 
              variant="outline" 
              onClick={handleCancelBooking}
              disabled={cancelBookingMutation.isPending}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 backdrop-blur-sm"
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

      {/* Payment Dialog */}
      {productData?.product && payNowOffer && tariff && (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          productId={productData.product.id}
          productName={productData.product.name}
          offerId={payNowOffer.id}
          tariffCode={tariff.code}
          price={`${payNowOffer.amount} BYN`}
          isSubscription={true}
        />
      )}
    </DashboardLayout>
  );
}
