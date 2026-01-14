import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, User, ArrowRight, ArrowLeft, Check, X } from "lucide-react";
import { z } from "zod";
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input";
import logoImage from "@/assets/logo.png";

const CURRENT_POLICY_VERSION = "v2026-01-07";

const loginSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: z.string().min(1, "Введите пароль"),
});

// Password requirements
const passwordRequirements = {
  minLength: 8,
  hasDigit: /\d/,
  hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
};

const validatePassword = (password: string) => {
  return {
    minLength: password.length >= passwordRequirements.minLength,
    hasDigit: passwordRequirements.hasDigit.test(password),
    hasSpecial: passwordRequirements.hasSpecial.test(password),
  };
};

const signupSchema = z.object({
  firstName: z.string().trim().min(2, "Имя должно содержать минимум 2 символа"),
  lastName: z.string().trim().min(2, "Фамилия должна содержать минимум 2 символа"),
  phone: z.string().refine((val) => isValidPhoneNumber(val), {
    message: "Введите корректный номер телефона",
  }),
  email: z.string().email("Введите корректный email"),
  password: z.string()
    .min(passwordRequirements.minLength, `Пароль должен содержать минимум ${passwordRequirements.minLength} символов`)
    .regex(passwordRequirements.hasDigit, "Пароль должен содержать минимум 1 цифру")
    .regex(passwordRequirements.hasSpecial, "Пароль должен содержать минимум 1 спецсимвол"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

const passwordSchema = z.object({
  password: z.string()
    .min(passwordRequirements.minLength, `Пароль должен содержать минимум ${passwordRequirements.minLength} символов`)
    .regex(passwordRequirements.hasDigit, "Пароль должен содержать минимум 1 цифру")
    .regex(passwordRequirements.hasSpecial, "Пароль должен содержать минимум 1 спецсимвол"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

type AuthMode = "login" | "signup" | "forgot" | "update_password" | "account_exists";

interface FieldError {
  field: string;
  message: string;
}

// State for account_exists mode


export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, session, signIn, signUp, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("+375");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [existingEmail, setExistingEmail] = useState(""); // For account_exists mode

  // Get redirectTo from URL params
  const redirectTo = searchParams.get("redirectTo") || "/dashboard";

  // Password validation state
  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const passwordsMatch = password === confirmPassword;

  // Set initial mode from URL param
  useEffect(() => {
    const modeParam = searchParams.get("mode");
    if (modeParam === "signup") {
      setMode("signup");
    } else if (modeParam === "reset") {
      setMode("update_password");
    }
  }, [searchParams]);

  // Detect recovery flow from URL or session event
  useEffect(() => {
    const modeParam = searchParams.get("mode");

    // If the user came from a recovery link, show the new password form immediately
    if (modeParam === "reset") {
      setMode("update_password");
    }

    // Supabase usually emits SIGNED_IN after /auth/v1/verify redirects back
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (modeParam === "reset" && (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY")) {
        setMode("update_password");
      }
    });

    return () => subscription.unsubscribe();
  }, [searchParams]);

  useEffect(() => {
    // Only redirect if user is logged in AND not in password update mode
    if (user && mode !== "update_password") {
      navigate(redirectTo);
    }
  }, [user, mode, navigate, redirectTo]);

  const getFieldError = (field: string) => {
    return fieldErrors.find(e => e.field === field)?.message;
  };

  const handlePhoneChange = (value: string) => {
    setPhone(value);
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors([]);

    if (!session) {
      toast({
        title: "Сессия не найдена",
        description: "Откройте ссылку из письма ещё раз — затем появится форма смены пароля.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    const validation = passwordSchema.safeParse({ password, confirmPassword });
    if (!validation.success) {
      const errors: FieldError[] = validation.error.errors.map(err => ({
        field: err.path[0] as string,
        message: err.message,
      }));
      setFieldErrors(errors);
      setIsSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (error) {
      toast({
        title: "Ошибка сервера",
        description: "Не удалось обновить пароль. Попробуйте позже.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Пароль обновлён",
        description: "Ваш пароль успешно изменён",
      });
      navigate("/");
    }
  };

  // Handle sending reset password from account_exists mode
  const handleSendResetFromExists = async () => {
    setIsSubmitting(true);
    try {
      await supabase.functions.invoke("auth-actions", {
        body: { action: "reset_password", email: existingEmail },
      });
      toast({
        title: "Письмо отправлено",
        description: "Проверьте почту для установки пароля",
      });
      setMode("login");
    } catch {
      toast({
        title: "Ошибка",
        description: "Не удалось отправить письмо. Попробуйте позже.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors([]);

    const emailValidation = z.string().email("Введите корректный email").safeParse(email);
    if (!emailValidation.success) {
      setFieldErrors([{ field: "email", message: emailValidation.error.errors[0].message }]);
      setIsSubmitting(false);
      return;
    }

    try {
      // Call public auth-actions edge function (no auth required)
      const { data, error } = await supabase.functions.invoke("auth-actions", {
        body: {
          action: "reset_password",
          email: email,
        },
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Письмо отправлено",
        description: "Проверьте почту для восстановления пароля",
      });
      setMode("login");
    } catch (err: any) {
      toast({
        title: "Ошибка сервера",
        description: "Не удалось отправить письмо. Попробуйте позже.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors([]);

    try {
      if (mode === "login") {
        const validation = loginSchema.safeParse({ email, password });
        if (!validation.success) {
          const errors: FieldError[] = validation.error.errors.map(err => ({
            field: err.path[0] as string,
            message: err.message,
          }));
          setFieldErrors(errors);
          setIsSubmitting(false);
          return;
        }

        const { error } = await signIn(email, password);
        if (error) {
          if (error.message === "Invalid login credentials") {
            setFieldErrors([{ field: "password", message: "Неверный email или пароль" }]);
          } else {
            toast({
              title: "Ошибка сервера",
              description: "Не удалось войти. Попробуйте позже.",
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: "Добро пожаловать!",
            description: "Вы успешно вошли в систему",
          });
          navigate(redirectTo);
        }
      } else if (mode === "signup") {
        // Check privacy consent
        if (!privacyConsent) {
          toast({
            title: "Необходимо согласие",
            description: "Для регистрации необходимо согласиться с Политикой конфиденциальности",
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }

        const validation = signupSchema.safeParse({ 
          email, 
          password, 
          confirmPassword,
          firstName: firstName.trim(), 
          lastName: lastName.trim(),
          phone 
        });
        
        if (!validation.success) {
          const errors: FieldError[] = validation.error.errors.map(err => ({
            field: err.path[0] as string,
            message: err.message,
          }));
          setFieldErrors(errors);
          setIsSubmitting(false);
          return;
        }

        const cleanPhone = phone.replace(/[^\d+]/g, '');
        const signUpResult = await signUp(email, password, firstName.trim(), lastName.trim(), cleanPhone);
        if (signUpResult.error) {
          if (signUpResult.error.message.includes("already registered")) {
            // Instead of just showing an error, redirect to account_exists mode
            setExistingEmail(email);
            setMode("account_exists");
          } else {
            toast({
              title: "Ошибка сервера",
              description: "Не удалось зарегистрироваться. Попробуйте позже.",
              variant: "destructive",
            });
          }
        } else {
          // Log consent after successful registration - use email to find profile
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("user_id")
              .eq("email", email.toLowerCase())
              .maybeSingle();

            if (profile?.user_id) {
              await supabase.from("consent_logs").insert({
                user_id: profile.user_id,
                email: email,
                consent_type: "privacy_policy",
                policy_version: CURRENT_POLICY_VERSION,
                granted: true,
                source: "registration",
              });

              await supabase.from("profiles").update({
                consent_version: CURRENT_POLICY_VERSION,
                consent_given_at: new Date().toISOString(),
              }).eq("user_id", profile.user_id);
            }
          } catch (consentError) {
            console.error("Error logging consent:", consentError);
          }

          toast({
            title: "Регистрация успешна!",
            description: "Не забудьте привязать Telegram и добавить карту для оплаты",
          });
          navigate(redirectTo);
        }
      }
    } catch (err) {
      toast({
        title: "Ошибка сервера",
        description: "Произошла ошибка. Попробуйте позже.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const PasswordRequirements = () => (
    <div className="mt-2 space-y-1 text-xs">
      <div className={`flex items-center gap-1.5 ${passwordValidation.minLength ? 'text-green-600' : 'text-muted-foreground'}`}>
        {passwordValidation.minLength ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
        <span>Минимум 8 символов</span>
      </div>
      <div className={`flex items-center gap-1.5 ${passwordValidation.hasDigit ? 'text-green-600' : 'text-muted-foreground'}`}>
        {passwordValidation.hasDigit ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
        <span>Минимум 1 цифра</span>
      </div>
      <div className={`flex items-center gap-1.5 ${passwordValidation.hasSpecial ? 'text-green-600' : 'text-muted-foreground'}`}>
        {passwordValidation.hasSpecial ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
        <span>Минимум 1 спецсимвол (!@#$%^&* и т.п.)</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradient */}
      <div 
        className="absolute inset-0 -z-10"
        style={{
          background: "linear-gradient(135deg, hsl(217 91% 60% / 0.1), hsl(240 80% 65% / 0.1))",
        }}
      />
      
      {/* Animated background shapes */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 rounded-full bg-primary/10 blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full bg-accent/10 blur-3xl animate-pulse delay-1000" />

      {/* Glass card */}
      <div className="w-full max-w-md">
        <div 
          className="rounded-3xl p-8 shadow-2xl border border-border/50"
          style={{
            background: "linear-gradient(135deg, hsl(0 0% 100% / 0.9), hsl(0 0% 100% / 0.7))",
            backdropFilter: "blur(20px)",
          }}
        >
        {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 mb-4">
              <img src={logoImage} alt="Буква Закона" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {mode === "login" && "Добро пожаловать"}
              {mode === "signup" && "Создать аккаунт"}
              {mode === "forgot" && "Восстановление пароля"}
              {mode === "update_password" && "Новый пароль"}
              {mode === "account_exists" && "Аккаунт уже существует"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {mode === "login" && "Войдите в свой аккаунт"}
              {mode === "signup" && "Зарегистрируйтесь для начала работы"}
              {mode === "forgot" && "Введите email для получения ссылки"}
              {mode === "update_password" && "Введите новый пароль для вашего аккаунта"}
              {mode === "account_exists" && "Для входа необходимо установить пароль"}
            </p>
          </div>

          {/* Update Password Form */}
          {mode === "update_password" ? (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">
                  Новый пароль
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('password') ? 'border-destructive' : ''}`}
                    placeholder="••••••••"
                    required
                    allowAutofill
                    autoComplete="new-password"
                  />
                </div>
                {getFieldError('password') && (
                  <p className="text-sm text-destructive">{getFieldError('password')}</p>
                )}
                <PasswordRequirements />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-foreground">
                  Повторите пароль
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => handleBlur('confirmPassword')}
                    className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('confirmPassword') || (touched.confirmPassword && !passwordsMatch && confirmPassword) ? 'border-destructive' : ''}`}
                    placeholder="••••••••"
                    required
                    allowAutofill
                    autoComplete="new-password"
                  />
                </div>
                {getFieldError('confirmPassword') && (
                  <p className="text-sm text-destructive">{getFieldError('confirmPassword')}</p>
                )}
                {touched.confirmPassword && !passwordsMatch && confirmPassword && !getFieldError('confirmPassword') && (
                  <p className="text-sm text-destructive">Пароли не совпадают</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || !session}
                className="w-full h-12 rounded-xl text-base font-medium bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Сохранить пароль
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>
          ) : mode === "account_exists" ? (
            /* Account Exists - Reset Password Flow */
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center">
                <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <Mail className="h-6 w-6 text-amber-600" />
                </div>
                <p className="text-sm text-amber-800">
                  Email <strong>{existingEmail}</strong> уже зарегистрирован в системе.
                  Для входа отправьте ссылку для установки пароля на вашу почту.
                </p>
              </div>
              
              <Button
                onClick={handleSendResetFromExists}
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl text-base font-medium bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Отправить ссылку для входа
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setMode("login")}
                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Вернуться ко входу
              </button>
            </div>
          ) : mode === "forgot" ? (
            /* Forgot Password Form */
            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('email') ? 'border-destructive' : ''}`}
                    placeholder="your@email.com"
                    required
                    allowAutofill
                    autoComplete="username"
                  />
                </div>
                {getFieldError('email') && (
                  <p className="text-sm text-destructive">{getFieldError('email')}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl text-base font-medium bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Отправить ссылку
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setMode("login")}
                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Вернуться к входу
              </button>
            </form>
          ) : (
            <>
              {/* Login/Signup Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "signup" && (
                  <>
                    {/* First Name & Last Name */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-foreground">
                          Имя
                        </Label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input
                            id="firstName"
                            type="text"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            onBlur={() => handleBlur('firstName')}
                            className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('firstName') ? 'border-destructive' : ''}`}
                            placeholder="Иван"
                            required
                          />
                        </div>
                        {getFieldError('firstName') && (
                          <p className="text-sm text-destructive">{getFieldError('firstName')}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-foreground">
                          Фамилия
                        </Label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                          <Input
                            id="lastName"
                            type="text"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            onBlur={() => handleBlur('lastName')}
                            className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('lastName') ? 'border-destructive' : ''}`}
                            placeholder="Иванов"
                            required
                          />
                        </div>
                        {getFieldError('lastName') && (
                          <p className="text-sm text-destructive">{getFieldError('lastName')}</p>
                        )}
                      </div>
                    </div>

                    {/* Phone with country selector */}
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-foreground">
                        Телефон
                      </Label>
                      <PhoneInput
                        id="phone"
                        value={phone}
                        onChange={handlePhoneChange}
                        onBlur={() => handleBlur('phone')}
                        placeholder="Номер телефона"
                        error={!!getFieldError('phone')}
                        required
                      />
                      {getFieldError('phone') && (
                        <p className="text-sm text-destructive">{getFieldError('phone')}</p>
                      )}
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => handleBlur('email')}
                      className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('email') ? 'border-destructive' : ''}`}
                      placeholder="your@email.com"
                      required
                      allowAutofill
                      autoComplete="username"
                    />
                  </div>
                  {getFieldError('email') && (
                    <p className="text-sm text-destructive">{getFieldError('email')}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="password" className="text-foreground">
                      Пароль
                    </Label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => setMode("forgot")}
                        className="text-xs text-primary hover:underline"
                      >
                        Забыли пароль?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => handleBlur('password')}
                      className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('password') ? 'border-destructive' : ''}`}
                      placeholder="••••••••"
                      required
                      allowAutofill
                      autoComplete="current-password"
                    />
                  </div>
                  {getFieldError('password') && (
                    <p className="text-sm text-destructive">{getFieldError('password')}</p>
                  )}
                  {mode === "signup" && <PasswordRequirements />}
                </div>

                {/* Confirm Password for signup */}
                {mode === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-foreground">
                      Повторите пароль
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onBlur={() => handleBlur('confirmPassword')}
                        className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('confirmPassword') || (touched.confirmPassword && !passwordsMatch && confirmPassword) ? 'border-destructive' : ''}`}
                        placeholder="••••••••"
                        required
                        allowAutofill
                        autoComplete="new-password"
                      />
                    </div>
                    {getFieldError('confirmPassword') && (
                      <p className="text-sm text-destructive">{getFieldError('confirmPassword')}</p>
                    )}
                {touched.confirmPassword && !passwordsMatch && confirmPassword && !getFieldError('confirmPassword') && (
                  <p className="text-sm text-destructive">Пароли не совпадают</p>
                )}
                  </div>
                )}

                {/* Privacy consent checkbox for signup */}
                {mode === "signup" && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50 border border-border/50">
                    <Checkbox
                      id="privacy-consent"
                      checked={privacyConsent}
                      onCheckedChange={(checked) => setPrivacyConsent(!!checked)}
                      className="mt-0.5"
                    />
                    <Label htmlFor="privacy-consent" className="text-sm leading-snug cursor-pointer">
                      Я согласен(на) с{" "}
                      <a 
                        href="/privacy" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Политикой конфиденциальности
                      </a>{" "}
                      и даю согласие на обработку персональных данных
                    </Label>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isSubmitting || (mode === "signup" && !privacyConsent)}
                  className="w-full h-12 rounded-xl text-base font-medium bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      {mode === "login" ? "Войти" : "Зарегистрироваться"}
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </form>

              {/* Toggle */}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "login" ? "signup" : "login");
                    setFieldErrors([]);
                    setTouched({});
                  }}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {mode === "login" ? (
                    <>Нет аккаунта? <span className="text-primary font-medium">Зарегистрируйтесь</span></>
                  ) : (
                    <>Уже есть аккаунт? <span className="text-primary font-medium">Войдите</span></>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
