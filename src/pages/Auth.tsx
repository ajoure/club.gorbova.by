import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, User, ArrowRight, Sparkles, ArrowLeft, Phone, Check, X } from "lucide-react";
import { z } from "zod";

// Belarusian phone format: +375 XX XXX-XX-XX
const formatBelarusianPhone = (value: string): string => {
  // Remove all non-digits except +
  const digits = value.replace(/[^\d+]/g, '');
  
  // Ensure it starts with +375
  let phone = digits;
  if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }
  if (phone === '+') {
    return '+375 ';
  }
  if (!phone.startsWith('+375') && phone.length > 1) {
    // If user started typing without +375, add it
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.startsWith('375')) {
      phone = '+' + digitsOnly;
    } else if (digitsOnly.length > 0) {
      phone = '+375' + digitsOnly;
    }
  }
  
  // Format: +375 XX XXX-XX-XX
  const match = phone.match(/^\+375(\d{0,2})(\d{0,3})(\d{0,2})(\d{0,2})$/);
  if (match) {
    let formatted = '+375';
    if (match[1]) formatted += ' ' + match[1];
    if (match[2]) formatted += ' ' + match[2];
    if (match[3]) formatted += '-' + match[3];
    if (match[4]) formatted += '-' + match[4];
    return formatted;
  }
  
  return phone.slice(0, 17); // Limit length
};

const unformatPhone = (value: string): string => {
  return value.replace(/[^\d+]/g, '');
};

const phoneRegex = /^\+375\d{9}$/;

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
  phone: z.string().refine((val) => phoneRegex.test(unformatPhone(val)), {
    message: "Введите номер в формате +375 XX XXX-XX-XX",
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

type AuthMode = "login" | "signup" | "forgot" | "update_password";

interface FieldError {
  field: string;
  message: string;
}

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
  const [phone, setPhone] = useState("+375 ");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatBelarusianPhone(e.target.value);
    setPhone(formatted);
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

        const cleanPhone = unformatPhone(phone);
        const { error } = await signUp(email, password, firstName.trim(), lastName.trim(), cleanPhone);
        if (error) {
          if (error.message.includes("already registered")) {
            setFieldErrors([{ field: "email", message: "Этот email уже зарегистрирован. Попробуйте войти." }]);
          } else {
            toast({
              title: "Ошибка сервера",
              description: "Не удалось зарегистрироваться. Попробуйте позже.",
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: "Регистрация успешна!",
            description: "Добро пожаловать в систему",
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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent mb-4">
              <Sparkles className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {mode === "login" && "Добро пожаловать"}
              {mode === "signup" && "Создать аккаунт"}
              {mode === "forgot" && "Восстановление пароля"}
              {mode === "update_password" && "Новый пароль"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {mode === "login" && "Войдите в свой аккаунт"}
              {mode === "signup" && "Зарегистрируйтесь для начала работы"}
              {mode === "forgot" && "Введите email для получения ссылки"}
              {mode === "update_password" && "Введите новый пароль для вашего аккаунта"}
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

                    {/* Phone with Belarusian mask */}
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-foreground">
                        Телефон
                      </Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={handlePhoneChange}
                          onBlur={() => handleBlur('phone')}
                          className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${getFieldError('phone') ? 'border-destructive' : ''}`}
                          placeholder="+375 44 356-15-12"
                          required
                        />
                      </div>
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

                <Button
                  type="submit"
                  disabled={isSubmitting}
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
