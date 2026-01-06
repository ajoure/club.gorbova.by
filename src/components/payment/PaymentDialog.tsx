import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, CreditCard, CheckCircle, ShieldCheck, User, KeyRound } from "lucide-react";
import { z } from "zod";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  price: string;
  tariffCode?: string;
  isTrial?: boolean;
  trialDays?: number;
}

const emailSchema = z.string().email("Введите корректный email");
const phoneSchema = z.string().min(10, "Введите корректный номер телефона");
const passwordSchema = z.string().min(6, "Пароль должен быть не менее 6 символов");

interface UserFormData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  password: string;
}

type Step = "email" | "login" | "additional_info" | "processing" | "ready";

interface EmailCheckResult {
  exists: boolean;
  hasPassword: boolean;
  maskedName?: string;
}

export function PaymentDialog({
  open,
  onOpenChange,
  productId,
  productName,
  price,
  tariffCode,
  isTrial,
  trialDays,
}: PaymentDialogProps) {
  const { user, session } = useAuth();
  const { isSuperAdmin, isAdmin } = usePermissions();
  const [step, setStep] = useState<Step>("email");
  const [isTestPaymentLoading, setIsTestPaymentLoading] = useState(false);
  const [formData, setFormData] = useState<UserFormData>({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<UserFormData>>({});
  const [existingUserId, setExistingUserId] = useState<string | null>(null);
  const [emailCheckResult, setEmailCheckResult] = useState<EmailCheckResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState<{ id: string; brand: string; last4: string } | null>(null);
  const [isLoadingCard, setIsLoadingCard] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSavedCard(null);
      setIsLoadingCard(false);
      if (user && session) {
        // User is authenticated - use their data
        setFormData({
          email: user.email || "",
          firstName: user.user_metadata?.full_name?.split(" ")[0] || "",
          lastName: user.user_metadata?.full_name?.split(" ").slice(1).join(" ") || "",
          phone: user.user_metadata?.phone || "",
          password: "",
        });
        setExistingUserId(user.id);
        setStep("ready");
        
        // Check for saved payment method
        setIsLoadingCard(true);
        (async () => {
          try {
            const { data, error } = await supabase
              .from("payment_methods")
              .select("id, brand, last4")
              .eq("user_id", user.id)
              .eq("status", "active")
              .eq("is_default", true)
              .maybeSingle();
            
            console.log("Payment methods query result:", { data, error });
            if (data) {
              setSavedCard({ id: data.id, brand: data.brand || "", last4: data.last4 || "" });
            }
          } catch (err) {
            console.error("Error loading payment method:", err);
          } finally {
            setIsLoadingCard(false);
          }
        })();
      } else {
        // User is not authenticated - start with email step
        setFormData({ email: "", firstName: "", lastName: "", phone: "", password: "" });
        setExistingUserId(null);
        setStep("email");
      }
      setErrors({});
      setEmailCheckResult(null);
      setLoginError(null);
    }
  }, [open, user, session]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setLoginError(null);

    const validation = emailSchema.safeParse(formData.email);
    if (!validation.success) {
      setErrors({ email: validation.error.errors[0].message });
      return;
    }

    setIsLoading(true);

    try {
      // Call edge function to check email
      const { data, error } = await supabase.functions.invoke("auth-check-email", {
        body: { email: formData.email.toLowerCase().trim() },
      });

      if (error) {
        console.error("Error checking email:", error);
        // Fallback to old behavior on error
        setStep("additional_info");
        return;
      }

      setEmailCheckResult(data);

      if (data.exists) {
        // User exists - show login step
        setStep("login");
      } else {
        // New user - collect info
        setStep("additional_info");
      }
    } catch (error) {
      console.error("Error checking email:", error);
      // On error, proceed to collect all info
      setStep("additional_info");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setErrors({});

    const passwordValidation = passwordSchema.safeParse(formData.password);
    if (!passwordValidation.success) {
      setErrors({ password: passwordValidation.error.errors[0].message });
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          setLoginError("Неверный пароль");
        } else {
          setLoginError(error.message);
        }
        return;
      }

      if (data.user) {
        // Successfully logged in
        setExistingUserId(data.user.id);
        
        // Get profile data
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (profile) {
          const nameParts = profile.full_name?.split(" ") || [];
          setFormData(prev => ({
            ...prev,
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            phone: profile.phone || "",
          }));
        }

        toast.success("Вход выполнен успешно");
        setStep("ready");
      }
    } catch (error) {
      console.error("Login error:", error);
      setLoginError("Произошла ошибка при входе");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setIsLoading(true);
    setLoginError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        formData.email.toLowerCase().trim(),
        {
          redirectTo: `${window.location.origin}/auth?mode=reset`,
        }
      );

      if (error) {
        setLoginError(error.message);
      } else {
        toast.success("Письмо для восстановления пароля отправлено на ваш email");
      }
    } catch (error) {
      console.error("Password reset error:", error);
      setLoginError("Ошибка отправки письма");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdditionalInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Partial<UserFormData> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "Введите имя";
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = "Введите фамилию";
    }
    const phoneValidation = phoneSchema.safeParse(formData.phone.replace(/\D/g, ""));
    if (!phoneValidation.success) {
      newErrors.phone = phoneValidation.error.errors[0].message;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setStep("ready");
  };

  const handlePayment = async () => {
    setIsLoading(true);
    setStep("processing");

    console.log("handlePayment called", { savedCard, tariffCode, user: !!user, productId });

    try {
      // If user has a saved card and tariffCode is provided, use direct charge
      if (savedCard && tariffCode && user) {
        console.log("Using direct charge with saved card:", savedCard.id);
        const { data, error } = await supabase.functions.invoke("direct-charge", {
          body: {
            productId,
            tariffCode,
            isTrial,
            trialDays,
            paymentMethodId: savedCard.id,
          },
        });

        if (error) {
          // Check if the error response contains alreadyUsedTrial flag
          const errorData = data || {};
          if (errorData.alreadyUsedTrial) {
            toast.warning("Вы уже использовали пробный период для этого продукта", {
              duration: 8000,
            });
            setStep("ready");
            return;
          }
          throw new Error(error.message || errorData.error || "Ошибка при оплате");
        }

        if (!data.success) {
          // If payment requires tokenization, fall back to redirect flow below
          if (data.requiresTokenization) {
            console.log("Falling back to redirect flow");
          } else if (data.requiresRedirect && data.redirectUrl) {
            // 3-D Secure required for saved-card charge
            console.log("3DS redirect required:", data.redirectUrl);
            window.location.href = data.redirectUrl;
            return;
          } else if (data.alreadyUsedTrial) {
            toast.warning("Вы уже использовали пробный период для этого продукта", {
              duration: 8000,
            });
            setStep("ready");
            return;
          } else {
            throw new Error(data.error || "Ошибка при оплате");
          }
        } else {
          // Payment status will be confirmed in UI (and purchases) based on the real provider result
          onOpenChange(false);
          const redirectUrl = data.orderId
            ? `/purchases?payment=processing&order=${data.orderId}`
            : `/purchases?payment=processing`;
          window.location.href = redirectUrl;
          return;
        }
      }

      // Fallback: redirect to bePaid checkout
      const { data, error } = await supabase.functions.invoke("bepaid-create-token", {
        body: {
          productId,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          customerFirstName: formData.firstName,
          customerLastName: formData.lastName,
          existingUserId,
          description: productName,
          tariffCode,
          isTrial,
          trialDays,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.success) {
        throw new Error(data.error || "Ошибка создания платежа");
      }

      // Redirect to bePaid checkout page
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        toast.error("Не удалось получить ссылку на оплату");
        setStep("ready");
      }
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(error instanceof Error ? error.message : "Ошибка при создании платежа");
      setStep("ready");
    } finally {
      setIsLoading(false);
    }
  };

  // Admin test payment
  const handleTestPayment = async () => {
    if (!isSuperAdmin() && !isAdmin()) {
      toast.error("Только администраторы могут использовать эту функцию");
      return;
    }

    setIsTestPaymentLoading(true);
    try {
      const { data: createData, error: createError } = await supabase.functions.invoke("bepaid-create-token", {
        body: {
          productId,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          customerFirstName: formData.firstName,
          customerLastName: formData.lastName,
          existingUserId,
          description: productName,
          tariffCode,
          isTrial,
          trialDays,
          skipRedirect: true,
        },
      });

      if (createError || !createData?.success) {
        throw new Error(createData?.error || createError?.message || "Ошибка создания заказа");
      }

      const orderId = createData.orderId;
      if (!orderId) {
        throw new Error("Не удалось получить ID заказа");
      }

      const { data, error } = await supabase.functions.invoke("test-payment-complete", {
        body: { orderId },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.success) {
        throw new Error(data.error || "Ошибка симуляции оплаты");
      }

      const results = data.results || {};
      const successDetails: string[] = [];
      
      if (results.order_updated) successDetails.push("✓ Заказ обновлён");
      if (results.entitlement_created) successDetails.push("✓ Доступ предоставлен");
      if (results.subscription_updated) successDetails.push("✓ Подписка активирована");
      if (results.telegram_access_granted > 0) {
        successDetails.push(`✓ Telegram: доступ к ${results.telegram_access_granted} клуб(ам)`);
      }
      if (results.getcourse_sync === "success") {
        successDetails.push(`✓ GetCourse: сделка #${results.getcourse_deal_id || 'создана'}`);
      } else if (results.getcourse_sync === "skipped") {
        successDetails.push("⏭ GetCourse: пропущено");
      } else if (results.getcourse_sync === "failed") {
        successDetails.push("⚠ GetCourse: ошибка синхронизации");
      }

      toast.success(
        <div className="space-y-2">
          <div className="font-semibold">Тестовая оплата выполнена!</div>
          <div className="text-sm space-y-1">
            {successDetails.map((detail, i) => (
              <div key={i}>{detail}</div>
            ))}
          </div>
        </div>,
        { duration: 8000 }
      );
      
      onOpenChange(false);
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      console.error("Test payment error:", error);
      toast.error(
        <div className="space-y-1">
          <div className="font-semibold">Ошибка тестовой оплаты</div>
          <div className="text-sm">{error instanceof Error ? error.message : "Неизвестная ошибка"}</div>
        </div>,
        { duration: 6000 }
      );
    } finally {
      setIsTestPaymentLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setFormData(prev => ({ ...prev, password: "" }));
    setEmailCheckResult(null);
    setLoginError(null);
    setErrors({});
    setStep("email");
  };

  const renderStep = () => {
    switch (step) {
      case "email":
        return (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={formData.email}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, email: e.target.value }));
                  setErrors(prev => ({ ...prev, email: undefined }));
                }}
                required
                disabled={isLoading}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
                className="flex-1"
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isLoading} className="flex-1">
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Продолжить
              </Button>
            </div>
          </form>
        );

      case "login":
        return (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {/* Show account info */}
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <User className="h-5 w-5" />
                <span className="font-medium">Это ваш аккаунт</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {emailCheckResult?.maskedName 
                  ? `${emailCheckResult.maskedName}, введите пароль, чтобы продолжить оплату`
                  : "Введите пароль, чтобы продолжить оплату"
                }
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                Email: {formData.email}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, password: e.target.value }));
                  setErrors(prev => ({ ...prev, password: undefined }));
                  setLoginError(null);
                }}
                required
                disabled={isLoading}
                autoFocus
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
              {loginError && (
                <p className="text-sm text-destructive">{loginError}</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-sm text-primary hover:underline"
              disabled={isLoading}
            >
              Забыли пароль?
            </button>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleChangeEmail}
                disabled={isLoading}
                className="flex-1"
              >
                Изменить email
              </Button>
              <Button type="submit" disabled={isLoading} className="flex-1">
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Войти и продолжить
              </Button>
            </div>
          </form>
        );

      case "additional_info":
        return (
          <form onSubmit={handleAdditionalInfoSubmit} className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                Email: {formData.email}
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              Заполним данные — и создадим личный кабинет после оплаты
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">Имя</Label>
                <Input
                  id="firstName"
                  placeholder="Иван"
                  value={formData.firstName}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, firstName: e.target.value }));
                    setErrors(prev => ({ ...prev, firstName: undefined }));
                  }}
                  disabled={isLoading}
                />
                {errors.firstName && (
                  <p className="text-sm text-destructive">{errors.firstName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Фамилия</Label>
                <Input
                  id="lastName"
                  placeholder="Иванов"
                  value={formData.lastName}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, lastName: e.target.value }));
                    setErrors(prev => ({ ...prev, lastName: undefined }));
                  }}
                  disabled={isLoading}
                />
                {errors.lastName && (
                  <p className="text-sm text-destructive">{errors.lastName}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Телефон</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+375 29 123 45 67"
                value={formData.phone}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, phone: e.target.value }));
                  setErrors(prev => ({ ...prev, phone: undefined }));
                }}
                disabled={isLoading}
              />
              {errors.phone && (
                <p className="text-sm text-destructive">{errors.phone}</p>
              )}
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p>После оплаты мы создадим для вас личный кабинет и отправим данные для входа на email.</p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleChangeEmail}
                disabled={isLoading}
                className="flex-1"
              >
                Назад
              </Button>
              <Button type="submit" disabled={isLoading} className="flex-1">
                Продолжить
              </Button>
            </div>
          </form>
        );

      case "ready":
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span>Email: {formData.email}</span>
              </div>
              {formData.firstName && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Имя: {formData.firstName} {formData.lastName}</span>
                </div>
              )}
              {formData.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Телефон: {formData.phone}</span>
                </div>
              )}
            </div>

            {savedCard ? (
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <span>Оплата сохранённой картой</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {savedCard.brand?.toUpperCase()} •••• {savedCard.last4}
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-primary/10 p-3 text-sm">
                <p>После нажатия кнопки вы будете перенаправлены на защищённую страницу оплаты bePaid.</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (user && session) {
                    onOpenChange(false);
                  } else {
                    handleChangeEmail();
                  }
                }}
                disabled={isLoading || isTestPaymentLoading}
                className="flex-1"
              >
                {user && session ? "Отмена" : "Назад"}
              </Button>
              <Button onClick={handlePayment} disabled={isLoading || isTestPaymentLoading || isLoadingCard} className="flex-1">
                {isLoadingCard ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                {savedCard 
                  ? (isTrial ? "Активировать триал" : `Оплатить ${price}`)
                  : `Оплатить ${price}`
                }
              </Button>
            </div>

            {/* Admin test payment button */}
            {(isSuperAdmin() || isAdmin()) && (
              <div className="border-t pt-4 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestPayment}
                  disabled={isLoading || isTestPaymentLoading}
                  className="w-full border-dashed border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                >
                  {isTestPaymentLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-4 w-4" />
                  )}
                  Тест: Симулировать оплату (только для админов)
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Создаёт заказ и симулирует успешный webhook от bePaid
                </p>
              </div>
            )}
          </div>
        );

      case "processing":
        return (
          <div className="text-center py-8">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
            <p className="text-muted-foreground">Подготовка платежа...</p>
          </div>
        );
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case "email":
        return "Введите email";
      case "login":
        return "Вход в аккаунт";
      case "additional_info":
        return "Данные для покупки";
      case "ready":
      case "processing":
        return "Подтверждение оплаты";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {getStepTitle()}
          </DialogTitle>
          <DialogDescription>
            {productName} — {price}
          </DialogDescription>
        </DialogHeader>

        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
