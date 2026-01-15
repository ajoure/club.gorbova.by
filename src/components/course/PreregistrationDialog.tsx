import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, MessageCircle, ExternalLink, LogIn } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { useAuth } from "@/contexts/AuthContext";
import { useTelegramLinkStatus, useStartTelegramLink } from "@/hooks/useTelegramLink";
import { useNavigate } from "react-router-dom";

interface PreregistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tariffName?: string;
  productCode?: string;
}

type Step = "auth_check" | "register" | "confirm" | "success" | "telegram_prompt";

export function PreregistrationDialog({ 
  open, 
  onOpenChange, 
  tariffName,
  productCode = "cb20_predzapis"
}: PreregistrationDialogProps) {
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { data: telegramStatus, isLoading: telegramLoading } = useTelegramLinkStatus();
  const startTelegramLink = useStartTelegramLink();
  
  const [step, setStep] = useState<Step>("auth_check");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    consent: false
  });

  // Determine initial step when dialog opens
  useEffect(() => {
    if (!open) return;
    
    if (authLoading) {
      setStep("auth_check");
      return;
    }

    if (user) {
      setStep("confirm");
    } else {
      setStep("register");
    }
  }, [open, user, authLoading]);

  // Pre-fill form data for logged-in users
  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email, phone")
          .eq("user_id", user.id)
          .single();
        
        if (profile) {
          setFormData(prev => ({
            ...prev,
            name: profile.full_name || "",
            email: profile.email || user.email || "",
            phone: profile.phone || ""
          }));
        } else {
          setFormData(prev => ({
            ...prev,
            email: user.email || ""
          }));
        }
      };
      fetchProfile();
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.consent) {
      toast({
        title: "Необходимо согласие",
        description: "Пожалуйста, подтвердите согласие на обработку данных",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const { data: insertedData, error } = await supabase
        .from("course_preregistrations" as any)
        .insert({
          name: formData.name,
          email: formData.email,
          phone: formData.phone || null,
          product_code: productCode,
          tariff_name: tariffName || null,
          consent: formData.consent,
          source: "landing",
          status: "new",
          user_id: user?.id || null
        })
        .select()
        .single();

      if (error) throw error;

      // Send notification (fire and forget)
      supabase.functions.invoke("course-prereg-notify", {
        body: {
          id: (insertedData as any)?.id,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          product_code: productCode,
          tariff_name: tariffName
        }
      }).catch(console.error);

      toast({
        title: "Заявка отправлена!",
        description: "Мы свяжемся с вами в ближайшее время",
      });
      
      // Check if telegram is linked
      if (telegramStatus?.status === 'active') {
        setStep("success");
      } else {
        setStep("telegram_prompt");
      }
    } catch (error) {
      console.error("Error submitting preregistration:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить заявку. Попробуйте позже.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartTelegramLink = async () => {
    try {
      const result = await startTelegramLink.mutateAsync();
      if (result.deep_link) {
        setTelegramDeepLink(result.deep_link);
      }
    } catch (error) {
      console.error("Error starting telegram link:", error);
    }
  };

  const handleLoginRedirect = () => {
    onOpenChange(false);
    const returnUrl = window.location.pathname + window.location.search;
    navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
  };

  const handleClose = () => {
    onOpenChange(false);
    setStep("auth_check");
    setTelegramDeepLink(null);
    setFormData({ name: "", email: "", phone: "", consent: false });
  };

  const renderContent = () => {
    // Loading state
    if (step === "auth_check" || authLoading || telegramLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    // Not logged in - prompt to register/login
    if (step === "register") {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Предзапись на курс</DialogTitle>
            <DialogDescription>
              Для записи на курс необходимо войти в личный кабинет или зарегистрироваться.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              В личном кабинете вы сможете отслеживать статус заявки, получать уведомления и управлять подписками.
            </p>
            
            <Button onClick={handleLoginRedirect} className="w-full">
              <LogIn className="mr-2 h-4 w-4" />
              Войти или зарегистрироваться
            </Button>
          </div>
        </>
      );
    }

    // Logged in - confirm registration
    if (step === "confirm") {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Подтверждение предзаписи</DialogTitle>
            <DialogDescription>
              {tariffName 
                ? `Тариф: ${tariffName}. Проверьте данные и подтвердите запись.`
                : "Проверьте данные и подтвердите запись на курс."
              }
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Имя</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ваше имя"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@example.com"
                disabled
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Телефон</Label>
              <PhoneInput
                value={formData.phone}
                onChange={(value) => setFormData({ ...formData, phone: value })}
                placeholder="+375 (XX) XXX-XX-XX"
              />
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox
                id="consent"
                checked={formData.consent}
                onCheckedChange={(checked) => 
                  setFormData({ ...formData, consent: checked as boolean })
                }
              />
              <Label htmlFor="consent" className="text-sm text-muted-foreground leading-tight">
                Я согласен(а) с{" "}
                <a href="/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  Политикой конфиденциальности
                </a>{" "}
                и даю{" "}
                <a href="/consent" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  согласие
                </a>{" "}
                на обработку персональных данных
              </Label>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                "Подтвердить запись"
              )}
            </Button>
          </form>
        </>
      );
    }

    // Success with telegram already linked
    if (step === "success") {
      return (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Заявка принята!
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Вы успешно записались на курс. Мы отправим уведомление в Telegram, когда курс откроется для записи.
            </p>
            
            <Button onClick={handleClose} className="w-full">
              Закрыть
            </Button>
          </div>
        </>
      );
    }

    // Prompt to link telegram
    if (step === "telegram_prompt") {
      return (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Заявка принята!
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <div className="rounded-lg bg-primary/10 p-4 border border-primary/20">
              <div className="flex items-start gap-3">
                <MessageCircle className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium text-sm">Привяжите Telegram для уведомлений</p>
                  <p className="text-sm text-muted-foreground">
                    Получайте мгновенные уведомления о статусе курса, напоминания и важные обновления прямо в Telegram.
                  </p>
                </div>
              </div>
            </div>

            {telegramDeepLink ? (
              <div className="space-y-3">
                <Button asChild className="w-full">
                  <a href={telegramDeepLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Открыть Telegram
                  </a>
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Нажмите кнопку и напишите боту /start для привязки
                </p>
              </div>
            ) : (
              <Button 
                onClick={handleStartTelegramLink} 
                className="w-full"
                disabled={startTelegramLink.isPending}
              >
                {startTelegramLink.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Подготовка...
                  </>
                ) : (
                  <>
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Привязать Telegram
                  </>
                )}
              </Button>
            )}

            <Button variant="outline" onClick={handleClose} className="w-full">
              Пропустить
            </Button>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
