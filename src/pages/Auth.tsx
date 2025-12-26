import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, User, ArrowRight, Sparkles, ArrowLeft, Phone } from "lucide-react";
import { z } from "zod";

const phoneRegex = /^\+[1-9]\d{6,14}$/;

const loginSchema = z.object({
  email: z.string().email("Введите корректный email"),
  password: z.string().min(6, "Пароль должен содержать минимум 6 символов"),
});

const signupSchema = loginSchema.extend({
  fullName: z.string().min(2, "Имя должно содержать минимум 2 символа"),
  phone: z.string().regex(phoneRegex, "Введите номер в формате +48123456789"),
});

type AuthMode = "login" | "signup" | "forgot";

export default function Auth() {
  const navigate = useNavigate();
  const { user, signIn, signUp, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const emailValidation = z.string().email("Введите корректный email").safeParse(email);
    if (!emailValidation.success) {
      toast({
        title: "Ошибка",
        description: emailValidation.error.errors[0].message,
        variant: "destructive",
      });
      setIsSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth?mode=reset`,
    });

    setIsSubmitting(false);

    if (error) {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Письмо отправлено",
        description: "Проверьте почту для восстановления пароля",
      });
      setMode("login");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const validation = loginSchema.safeParse({ email, password });
        if (!validation.success) {
          toast({
            title: "Ошибка валидации",
            description: validation.error.errors[0].message,
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }

        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: "Ошибка входа",
            description: error.message === "Invalid login credentials" 
              ? "Неверный email или пароль" 
              : error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Добро пожаловать!",
            description: "Вы успешно вошли в систему",
          });
          navigate("/");
        }
      } else if (mode === "signup") {
        const validation = signupSchema.safeParse({ email, password, fullName, phone });
        if (!validation.success) {
          toast({
            title: "Ошибка валидации",
            description: validation.error.errors[0].message,
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }

        const { error } = await signUp(email, password, fullName, phone);
        if (error) {
          if (error.message.includes("already registered")) {
            toast({
              title: "Пользователь существует",
              description: "Этот email уже зарегистрирован. Попробуйте войти.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Ошибка регистрации",
              description: error.message,
              variant: "destructive",
            });
          }
        } else {
          toast({
            title: "Регистрация успешна!",
            description: "Добро пожаловать в систему",
          });
          navigate("/");
        }
      }
    } catch (err) {
      toast({
        title: "Ошибка",
        description: "Произошла неизвестная ошибка",
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
            </h1>
            <p className="text-muted-foreground mt-2">
              {mode === "login" && "Войдите в свой аккаунт"}
              {mode === "signup" && "Зарегистрируйтесь для начала работы"}
              {mode === "forgot" && "Введите email для получения ссылки"}
            </p>
          </div>

          {/* Forgot Password Form */}
          {mode === "forgot" ? (
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
                    className="pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary"
                    placeholder="your@email.com"
                    required
                  />
                </div>
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
              <form onSubmit={handleSubmit} className="space-y-5">
                {mode === "signup" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="fullName" className="text-foreground">
                        Полное имя
                      </Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          id="fullName"
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary"
                          placeholder="Иван Иванов"
                          required
                        />
                      </div>
                    </div>
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
                          onChange={(e) => setPhone(e.target.value)}
                          className="pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary"
                          placeholder="+48123456789"
                          required
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Формат: +код страны номер</p>
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
                      className="pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary"
                      placeholder="your@email.com"
                      required
                    />
                  </div>
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
                      className="pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary"
                      placeholder="••••••••"
                      required
                    />
                  </div>
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
                  onClick={() => setMode(mode === "login" ? "signup" : "login")}
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
