import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useConsent } from "@/hooks/useConsent";
import { Switch } from "@/components/ui/switch";
import { GlassCard } from "@/components/ui/GlassCard";
import { Shield, ShieldCheck, ShieldX, Mail, ExternalLink, History, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export default function ConsentsSettings() {
  const {
    currentPolicy,
    profileConsent,
    consentHistory,
    isLoading,
    updateMarketingConsent,
  } = useConsent();
  const [isUpdatingMarketing, setIsUpdatingMarketing] = useState(false);

  const hasPrivacyConsent = !!profileConsent?.consent_version;
  const hasMarketingConsent = profileConsent?.marketing_consent ?? false;

  const handleMarketingToggle = async (checked: boolean) => {
    setIsUpdatingMarketing(true);
    try {
      await updateMarketingConsent.mutateAsync({ granted: checked });
      toast.success(checked ? "Подписка на рассылку активирована" : "Подписка на рассылку отключена");
    } catch (error) {
      console.error("Error updating marketing consent:", error);
      toast.error("Ошибка при обновлении настроек");
    } finally {
      setIsUpdatingMarketing(false);
    }
  };

  const formatConsentType = (type: string) => {
    switch (type) {
      case "privacy_policy":
        return "Политика конфиденциальности";
      case "marketing":
        return "Маркетинговые рассылки";
      default:
        return type;
    }
  };

  const formatSource = (source: string) => {
    switch (source) {
      case "registration":
        return "Регистрация";
      case "payment":
        return "Оплата";
      case "settings":
        return "Настройки";
      case "modal":
        return "Обновление политики";
      default:
        return source;
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Управление согласиями</h1>
          <p className="text-muted-foreground mt-1">
            Настройки обработки персональных данных
          </p>
        </div>

        {/* Privacy Policy Consent */}
        <GlassCard className="p-6">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl shrink-0 ${hasPrivacyConsent ? "bg-primary/10" : "bg-muted"}`}>
              {hasPrivacyConsent ? (
                <ShieldCheck className="h-6 w-6 text-primary" />
              ) : (
                <ShieldX className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-lg">
                Согласие на обработку персональных данных
              </h2>
              
              {hasPrivacyConsent ? (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Дано: {profileConsent?.consent_given_at && format(
                      new Date(profileConsent.consent_given_at),
                      "d MMMM yyyy 'в' HH:mm",
                      { locale: ru }
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Версия политики: {profileConsent?.consent_version}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">
                  Согласие не дано
                </p>
              )}

              <div className="mt-4">
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  Политика конфиденциальности
                </a>
              </div>

              {/* Info about revocation */}
              <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm text-muted-foreground">
                    <p>
                      Для отзыва согласия на обработку персональных данных направьте 
                      письменное заявление на электронную почту{" "}
                      <a 
                        href="mailto:info@ajoure.by" 
                        className="text-primary hover:underline font-medium"
                      >
                        info@ajoure.by
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Marketing Consent */}
        <GlassCard className="p-6">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl shrink-0 ${hasMarketingConsent ? "bg-primary/10" : "bg-muted"}`}>
              <Mail className={`h-6 w-6 ${hasMarketingConsent ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-lg">Маркетинговые рассылки</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Получать новости и специальные предложения
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isUpdatingMarketing && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Switch
                    id="marketing-consent"
                    checked={hasMarketingConsent}
                    onCheckedChange={handleMarketingToggle}
                    disabled={isUpdatingMarketing}
                  />
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Consent History */}
        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-muted">
              <History className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="font-semibold text-lg">История согласий</h2>
          </div>

          {consentHistory && consentHistory.length > 0 ? (
            <div className="space-y-3">
              {consentHistory.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    {log.granted ? (
                      <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <ShieldX className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {formatConsentType(log.consent_type)} — {log.granted ? "Дано" : "Отозвано"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatSource(log.source)} • Версия {log.policy_version}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(log.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              История согласий пуста
            </p>
          )}
        </GlassCard>
      </div>
    </DashboardLayout>
  );
}