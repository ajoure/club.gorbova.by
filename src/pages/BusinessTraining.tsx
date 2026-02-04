import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { PreregistrationDialog } from "@/components/course/PreregistrationDialog";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { ProductLandingHeader } from "@/components/landing/ProductLandingHeader";
import { ProductLandingFooter } from "@/components/landing/ProductLandingFooter";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import { toast } from "sonner";
import { 
  Calendar, 
  CheckCircle, 
  Users, 
  Video, 
  MessageSquare,
  ArrowRight,
  CreditCard,
  Bell,
  Briefcase,
  TrendingUp,
  Clock,
  Check,
  XCircle,
  Loader2,
  ShoppingCart
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import katerinaImage from "@/assets/katerina-business.jpg";

const benefits = [
  {
    icon: Video,
    title: "Ежемесячные вебинары",
    description: "Live-тренинги с Катериной Горбовой + записи",
  },
  {
    icon: Briefcase,
    title: "От найма к бизнесу",
    description: "Пошаговый план построения своей практики",
  },
  {
    icon: Users,
    title: "Закрытое сообщество",
    description: "Нетворкинг с единомышленниками",
  },
  {
    icon: MessageSquare,
    title: "Обратная связь",
    description: "Домашние задания с проверкой от эксперта",
  },
];

const whatIncluded = [
  "1 обучающий вебинар в месяц (live + запись)",
  "Чат с участниками и экспертом",
  "Домашние задания с обратной связью",
  "Шаблоны и чек-листы для старта бизнеса",
  "Прогресс-трекер вашего пути",
];

export default function BusinessTraining() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showPreregistration, setShowPreregistration] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  // Fetch dynamic product data from API
  const { data: productData } = usePublicProduct("business-training.gorbova.by", user?.id);

  // Extract tariff and dynamic offers from product data
  const tariff = productData?.tariffs?.[0];
  
  // Filter offers by type (API already filters by is_active)
  const payNowOffers = useMemo(() => 
    tariff?.offers?.filter(o => o.offer_type === "pay_now") || [], 
    [tariff]
  );
  const preregOffers = useMemo(() => 
    tariff?.offers?.filter(o => o.offer_type === "preregistration") || [], 
    [tariff]
  );
  
  const primaryPayOffer = payNowOffers.find(o => o.is_primary) || payNowOffers[0];

  // Extract dynamic settings from product data
  const dynamicSettings = useMemo(() => {
    if (!tariff) {
      return {
        startDate: "5 февраля 2026",
        price: 250,
        chargeWindowStart: 1,
        chargeWindowEnd: 4,
        notifyDays: 1,
        tariffName: "Ежемесячный доступ",
      };
    }

    const preregOffer = tariff.offers.find(o => o.offer_type === "preregistration");
    const payNowOffer = tariff.offers.find(o => o.offer_type === "pay_now" && o.is_primary);
    
    const preregMeta = preregOffer?.meta?.preregistration;
    const payNowMeta = payNowOffer?.meta;
    
    const chargeDate = preregMeta?.first_charge_date;
    
    let formattedStartDate = "5 февраля 2026";
    if (chargeDate) {
      try {
        formattedStartDate = format(new Date(chargeDate), "d MMMM yyyy", { locale: ru });
      } catch {}
    }

    return {
      startDate: formattedStartDate,
      price: payNowOffer?.amount || 250,
      chargeWindowStart: preregMeta?.charge_window_start || payNowMeta?.charge_window_start || 1,
      chargeWindowEnd: preregMeta?.charge_window_end || payNowMeta?.charge_window_end || 4,
      notifyDays: preregMeta?.notify_before_days || 1,
      tariffName: tariff.name || "Ежемесячный доступ",
    };
  }, [tariff]);

  // Dynamic payment terms based on product settings
  const paymentTerms = useMemo(() => [
    { icon: CreditCard, text: "Привязка карты в личном кабинете" },
    { icon: Bell, text: `Уведомление за ${dynamicSettings.notifyDays} ${dynamicSettings.notifyDays === 1 ? "день" : "дня"} до списания` },
    { icon: Calendar, text: `Автосписание с ${dynamicSettings.chargeWindowStart} по ${dynamicSettings.chargeWindowEnd} число месяца` },
  ], [dynamicSettings]);

  // Check if user has existing booking or active subscription
  const { data: existingAccess } = useQuery({
    queryKey: ["buh-business-landing-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return { hasPreregistration: false, hasActiveSubscription: false, preregistrationId: null };
      
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
        .select("id, status")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .eq("status", "active")
        .maybeSingle();
      
      return {
        hasPreregistration: !!preregistration,
        hasActiveSubscription: !!entitlement,
        preregistrationId: preregistration?.id || null,
      };
    },
    enabled: !!user?.id,
  });

  // Cancel booking mutation
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
      queryClient.invalidateQueries({ queryKey: ["buh-business-access", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["buh-business-landing-access", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["public-product"] });
    },
    onError: (error: Error) => {
      console.error("Cancel error:", error);
      toast.error(error.message || "Не удалось отменить бронь");
    },
  });

  const handleCancelBooking = () => {
    if (existingAccess?.preregistrationId) {
      cancelBookingMutation.mutate(existingAccess.preregistrationId);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col relative overflow-hidden">
      {/* Decorative floating orbs */}
      <div className="absolute top-20 right-10 w-96 h-96 rounded-full bg-primary/8 blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -left-20 w-80 h-80 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-40 right-1/4 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-primary/5 to-accent/5 blur-3xl pointer-events-none" />

      {/* Standard Header */}
      <ProductLandingHeader 
        productName="Бухгалтерия как бизнес"
        subtitle="Бизнес-тренинг"
        navItems={[
          { label: "Тарифы", sectionId: "pricing" },
        ]}
      />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/15 rounded-full blur-3xl" />
          <div className="absolute top-1/2 -left-20 w-60 h-60 bg-accent/15 rounded-full blur-3xl" />
        </div>

        <div className="container mx-auto px-4 py-12 lg:py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Content */}
            <div className="space-y-6 z-10">
              <Badge 
                variant="secondary" 
                className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 px-4 py-1.5 backdrop-blur-sm"
              >
                <Calendar className="h-3.5 w-3.5 mr-1.5" />
                Старт {dynamicSettings.startDate}
              </Badge>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground leading-tight drop-shadow-sm">
                Бухгалтерия как бизнес
              </h1>

              <p className="text-lg text-muted-foreground/90 max-w-xl">
                Построй бизнес на исключительном профессионализме со стабильными продажами 
                и высоким удержанием клиентов
              </p>

              {/* Benefits grid - Enhanced glassmorphism */}
              <div className="grid sm:grid-cols-2 gap-4 pt-4">
                {benefits.map((benefit, index) => (
                  <div 
                    key={index} 
                    className="flex items-start gap-3 p-4 rounded-2xl backdrop-blur-xl border border-border/30 hover:border-primary/30 transition-all duration-300"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.2))",
                      boxShadow: "0 8px 32px rgba(0, 0, 0, 0.06), inset 0 1px 0 hsl(0 0% 100% / 0.15)"
                    }}
                  >
                    <div className="p-2.5 rounded-xl bg-primary/15 text-primary shrink-0 backdrop-blur-sm">
                      <benefit.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">{benefit.title}</p>
                      <p className="text-xs text-muted-foreground/90">{benefit.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Status badges */}
              {existingAccess?.hasActiveSubscription && (
                <div className="flex items-center gap-2">
                  <Badge 
                    variant="outline" 
                    className="bg-emerald-500/15 text-emerald-600 border-0 px-3 py-1.5 backdrop-blur-sm"
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" /> Активный доступ
                  </Badge>
                </div>
              )}
              {existingAccess?.hasPreregistration && !existingAccess?.hasActiveSubscription && (
                <div className="flex items-center gap-2">
                  <Badge 
                    variant="outline" 
                    className="bg-amber-500/20 text-amber-600 border-0 px-3 py-1.5 backdrop-blur-sm"
                  >
                    <Clock className="h-3.5 w-3.5 mr-1.5" /> У вас есть бронь
                  </Badge>
                </div>
              )}

              {/* CTA - Dynamically render buttons from tariff_offers */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                {existingAccess?.hasActiveSubscription ? (
                  // Active subscription - go to content
                  <Button 
                    size="lg" 
                    className="bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
                    onClick={() => navigate("/library/buh-business")}
                  >
                    Перейти к тренингу
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    {/* Single primary Pay Now button */}
                    {primaryPayOffer && (
                      <Button 
                        size="lg" 
                        className="bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
                        onClick={() => setShowPayment(true)}
                      >
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        {primaryPayOffer.button_label}
                      </Button>
                    )}
                    
                    {existingAccess?.hasPreregistration ? (
                      // Has preregistration - show cancel button
                      <Button 
                        variant="outline" 
                        size="lg"
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
                    ) : (
                      // Preregistration buttons (only if any exist from API = is_active: true)
                      preregOffers.map((offer) => (
                        <Button 
                          key={offer.id}
                          variant="outline" 
                          size="lg"
                          onClick={() => setShowPreregistration(true)}
                          className="backdrop-blur-sm border-border/50 hover:border-primary/50 hover:bg-primary/5"
                        >
                          {offer.button_label}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Image */}
            <div className="relative lg:order-last">
              <div className="relative z-10">
                <div 
                  className="p-2 overflow-hidden rounded-2xl backdrop-blur-xl border border-border/30"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--card) / 0.6), hsl(var(--card) / 0.3))",
                    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.1), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
                  }}
                >
                  <img 
                    src={katerinaImage} 
                    alt="Катерина Горбова — эксперт по бухгалтерии" 
                    className="w-full h-auto max-h-[500px] object-cover rounded-xl"
                    style={{ objectPosition: "center 15%", transform: "scale(1.2)" }}
                  />
                </div>
                
                {/* Floating badge - Enhanced glass */}
                <div className="absolute -bottom-4 -left-4 z-20">
                  <div 
                    className="px-5 py-4 flex items-center gap-3 rounded-2xl backdrop-blur-2xl border border-border/40"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.8))",
                      boxShadow: "0 20px 50px rgba(0, 0, 0, 0.12), inset 0 1px 0 hsl(0 0% 100% / 0.3)"
                    }}
                  >
                    <div className="p-2.5 rounded-xl bg-primary/15 text-primary backdrop-blur-sm">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">Катерина Горбова</p>
                      <p className="text-xs text-muted-foreground/90">Эксперт, 15+ лет опыта</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Decorative elements */}
              <div className="absolute -top-4 -right-4 w-full h-full bg-gradient-to-br from-primary/15 to-accent/10 rounded-2xl -z-10 blur-sm" />
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-12 lg:py-20 relative">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <div 
              className="relative p-8 lg:p-10 rounded-3xl backdrop-blur-2xl border border-border/40 overflow-hidden"
              style={{
                background: "linear-gradient(135deg, hsl(var(--card) / 0.6), hsl(var(--card) / 0.35))",
                boxShadow: "0 25px 60px rgba(0, 0, 0, 0.08), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
              }}
            >
              {/* Inner glow gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none rounded-3xl" />
              <div className="absolute -top-32 -right-32 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10">
                <div className="text-center mb-8">
                  <Badge 
                    variant="outline" 
                    className="mb-4 backdrop-blur-sm bg-card/30 border-border/50"
                  >
                    Один тариф — всё включено
                  </Badge>
                  <h2 className="text-2xl lg:text-3xl font-bold mb-2 text-foreground drop-shadow-sm">
                    {dynamicSettings.tariffName}
                  </h2>
                  <div className="flex items-baseline justify-center gap-2">
                    <span className="text-4xl lg:text-5xl font-bold text-primary drop-shadow-sm">{dynamicSettings.price}</span>
                    <span className="text-xl text-muted-foreground/90">BYN/месяц</span>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8 mb-8">
                  {/* What's included */}
                  <div 
                    className="p-5 rounded-2xl backdrop-blur-xl border border-border/30"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--card) / 0.4), hsl(var(--card) / 0.15))",
                    }}
                  >
                    <h3 className="font-semibold mb-4 flex items-center gap-2 text-foreground">
                      <div className="p-1.5 rounded-lg bg-emerald-500/15">
                        <CheckCircle className="h-5 w-5 text-emerald-500" />
                      </div>
                      Что входит
                    </h3>
                    <ul className="space-y-3">
                      {whatIncluded.map((item, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span className="text-foreground/90">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Payment terms */}
                  <div 
                    className="p-5 rounded-2xl backdrop-blur-xl border border-border/30"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--card) / 0.4), hsl(var(--card) / 0.15))",
                    }}
                  >
                    <h3 className="font-semibold mb-4 flex items-center gap-2 text-foreground">
                      <div className="p-1.5 rounded-lg bg-primary/15">
                        <CreditCard className="h-5 w-5 text-primary" />
                      </div>
                      Условия оплаты
                    </h3>
                    <ul className="space-y-3">
                      {paymentTerms.map((term, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <term.icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span className="text-foreground/90">{term.text}</span>
                        </li>
                      ))}
                    </ul>
                    <p 
                      className="text-xs text-muted-foreground mt-4 p-3 rounded-xl backdrop-blur-sm border border-border/20"
                      style={{ background: "hsl(var(--muted) / 0.3)" }}
                    >
                      Отмена подписки в любой момент в личном кабинете. 
                      При неуспешном списании доступ приостанавливается.
                    </p>
                  </div>
                </div>

                {/* CTA - Dynamically render buttons from tariff_offers */}
                <div className="text-center space-y-4" id="pricing">
                  {existingAccess?.hasActiveSubscription ? (
                    <Button 
                      size="lg" 
                      className="w-full sm:w-auto px-12 bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
                      onClick={() => navigate("/library/buh-business")}
                    >
                      Перейти к тренингу
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      {/* Single primary Pay Now button */}
                      {primaryPayOffer && (
                        <Button 
                          size="lg" 
                          className="px-12 bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25"
                          onClick={() => setShowPayment(true)}
                        >
                          <ShoppingCart className="mr-2 h-4 w-4" />
                          {primaryPayOffer.button_label}
                        </Button>
                      )}
                      
                      {/* Preregistration buttons (only if has active offers and user has no existing booking) */}
                      {!existingAccess?.hasPreregistration && preregOffers.map((offer) => (
                        <Button 
                          key={offer.id}
                          variant="outline"
                          size="lg" 
                          className="px-8 backdrop-blur-sm border-border/50 hover:border-primary/50 hover:bg-primary/5"
                          onClick={() => setShowPreregistration(true)}
                        >
                          {offer.button_label}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground/80">
                    Нажимая кнопку, вы соглашаетесь с{" "}
                    <a href="/offer" className="underline hover:text-foreground transition-colors">Офертой</a>
                    {" "}и{" "}
                    <a href="/privacy" className="underline hover:text-foreground transition-colors">Политикой конфиденциальности</a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Preregistration Dialog */}
      <PreregistrationDialog
        open={showPreregistration}
        onOpenChange={setShowPreregistration}
        tariffName={`${dynamicSettings.tariffName} — ${dynamicSettings.price} BYN/мес`}
        productCode="buh_business"
      />

      {/* Payment Dialog */}
      {productData?.product && primaryPayOffer && tariff && (
        <PaymentDialog
          open={showPayment}
          onOpenChange={setShowPayment}
          productId={productData.product.id}
          productName={productData.product.name}
          offerId={primaryPayOffer.id}
          tariffCode={tariff.code}
          price={`${primaryPayOffer.amount} BYN`}
          isSubscription={true}
          subscriptionMessage={{
            title: "Квест «Бухгалтерия как бизнес»",
            startDate: dynamicSettings.startDate,
            nextChargeInfo: "🎯 Это пошаговый квест с ежемесячным автосписанием.\n\n📍 Присоединиться можно только в начале — войти с середины нельзя.\n\n📚 Вы начинаете с 1-го модуля. Каждый оплаченный месяц = новый модуль.\n\n✨ Отменить подписку можно в любой момент в личном кабинете — без звонков и обязательств.",
          }}
        />
      )}

      {/* Standard Footer */}
      <ProductLandingFooter />
    </div>
  );
}
