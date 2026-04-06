import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTelegramLinkStatus, useStartTelegramLink } from "@/hooks/useTelegramLink";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle, CreditCard, CheckCircle2, ExternalLink, HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";

const REMIND_LATER_DAYS = 7;

export function WelcomeOnboardingModal() {
  const { user } = useAuth();
  const { profile, bootstrapReady } = useAuthBootstrap();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const { data: telegramStatus, isLoading: telegramLoading } = useTelegramLinkStatus();
  const { mutate: startLink, isPending: isLinking, data: linkSession } = useStartTelegramLink();

  const isTelegramLinked = telegramStatus?.status === "active" || !!telegramStatus?.telegram_username;

  // B1: Use bootstrap profile for onboarding state — no separate profiles query
  const onboardingState = profile
    ? {
        onboarding_dismissed_at: profile.onboarding_dismissed_at,
        onboarding_completed_at: profile.onboarding_completed_at,
      }
    : null;

  // B3: has-active-setup only starts after bootstrapReady AND if not already dismissed/completed
  const shouldCheckSetup =
    bootstrapReady &&
    !!user?.id &&
    !profile?.onboarding_completed_at &&
    !(
      profile?.onboarding_dismissed_at &&
      (Date.now() - new Date(profile.onboarding_dismissed_at).getTime()) / (1000 * 60 * 60 * 24) < REMIND_LATER_DAYS
    );

  const { data: hasActiveSetup } = useQuery({
    queryKey: ["has-active-setup", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;

      const { data: subscriptions } = await supabase
        .from("subscriptions_v2")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1);

      if (subscriptions && subscriptions.length > 0) return true;

      const { data: paymentMethods } = await supabase
        .from("payment_methods")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1);

      return paymentMethods && paymentMethods.length > 0;
    },
    enabled: shouldCheckSetup,
    staleTime: 5 * 60 * 1000,
  });

  // Mutation to update onboarding state
  const updateOnboardingState = useMutation({
    mutationFn: async (action: 'dismiss' | 'complete') => {
      if (!user?.id) throw new Error("No user");

      const updates = action === 'complete'
        ? { onboarding_completed_at: new Date().toISOString() }
        : { onboarding_dismissed_at: new Date().toISOString() };

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-bootstrap-profile", user?.id] });
    },
  });

  useEffect(() => {
    if (!user || !bootstrapReady || telegramLoading) return;

    if (onboardingState?.onboarding_completed_at) {
      setIsOpen(false);
      return;
    }

    if (hasActiveSetup) {
      setIsOpen(false);
      return;
    }

    if (onboardingState?.onboarding_dismissed_at) {
      const dismissedAt = new Date(onboardingState.onboarding_dismissed_at);
      const daysSinceDismissed = (Date.now() - dismissedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < REMIND_LATER_DAYS) {
        setIsOpen(false);
        return;
      }
    }

    const timer = setTimeout(() => setIsOpen(true), 500);
    return () => clearTimeout(timer);
  }, [user, bootstrapReady, telegramLoading, onboardingState, hasActiveSetup]);

  const handleComplete = () => {
    updateOnboardingState.mutate('complete');
    setIsOpen(false);
  };

  const handleRemindLater = () => {
    updateOnboardingState.mutate('dismiss');
    setIsOpen(false);
  };

  const handleStartTelegramLink = () => {
    startLink();
  };

  if (!user || telegramLoading || !bootstrapReady) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleRemindLater()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="text-2xl">🎉</span> Добро пожаловать в клуб!
          </DialogTitle>
          <DialogDescription>
            Чтобы получить полный доступ ко всем возможностям, выполните эти шаги:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Step 1: Telegram */}
          <div className={`flex items-start gap-3 p-3 rounded-lg border ${isTelegramLinked ? "bg-green-50 border-green-200" : "bg-muted/50 border-border"}`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isTelegramLinked ? "bg-green-500" : "bg-primary"}`}>
              {isTelegramLinked ? (
                <CheckCircle2 className="w-5 h-5 text-white" />
              ) : (
                <MessageCircle className="w-5 h-5 text-primary-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-foreground">1. Привяжите Telegram</h4>
              <p className="text-sm text-muted-foreground mt-0.5">
                Для уведомлений и доступа к чатам клуба
              </p>
              {!isTelegramLinked && (
                <div className="mt-2">
                  {linkSession?.deep_link ? (
                    <Button size="sm" asChild>
                      <a href={linkSession.deep_link} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4 mr-1.5" />
                        Открыть Telegram
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleStartTelegramLink} disabled={isLinking}>
                      <MessageCircle className="w-4 h-4 mr-1.5" />
                      {isLinking ? "Загрузка..." : "Привязать Telegram"}
                    </Button>
                  )}
                </div>
              )}
              {isTelegramLinked && (
                <p className="text-sm text-green-600 mt-1 font-medium">
                  ✓ Telegram привязан
                </p>
              )}
            </div>
          </div>

          {/* Step 2: Card */}
          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50 border-border">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-foreground">2. Добавьте карту для оплаты</h4>
              <p className="text-sm text-muted-foreground mt-0.5">
                Для автоматического продления подписки
              </p>
              <div className="mt-2">
                <Button size="sm" variant="outline" asChild onClick={handleComplete}>
                  <Link to="/settings/payment-methods">
                    <CreditCard className="w-4 h-4 mr-1.5" />
                    Перейти к настройкам
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Support */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <HelpCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <div className="text-sm">
              <span className="text-blue-900">Нужна помощь? Напишите </span>
              <a
                href="https://t.me/Gorbova_club_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-medium"
              >
                @Gorbova_club_bot
              </a>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={handleRemindLater}>
            Напомнить позже
          </Button>
          <Button onClick={handleComplete}>
            Готово
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
