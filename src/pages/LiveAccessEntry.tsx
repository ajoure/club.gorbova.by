import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Lock, AlertTriangle, Clock, ShieldX, UserX, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";

type EntryState =
  | "loading"
  | "auth_required"
  | "token_not_found"
  | "already_used"
  | "token_expired"
  | "token_revoked"
  | "token_mismatch"
  | "access_denied"
  | "event_not_found"
  | "event_unpublished"
  | "redirecting"
  | "error";

export default function LiveAccessEntry() {
  const { token } = useParams<{ token: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<EntryState>("loading");

  useEffect(() => {
    if (!token) {
      setState("token_not_found");
      return;
    }

    if (!session) {
      // Redirect to auth with return URL
      const returnUrl = `/live-access/${token}`;
      navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`, { replace: true });
      return;
    }

    const validate = async () => {
      setState("loading");
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-token-validate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "validate", token }),
          }
        );

        const json = await response.json();

        switch (json.status) {
          case "ok":
            setState("redirecting");
            navigate(`/live/${json.redirect_slug}`, { replace: true });
            break;
          case "token_not_found":
            setState("token_not_found");
            break;
          case "already_used":
            setState("already_used");
            break;
          case "token_expired":
            setState("token_expired");
            break;
          case "token_revoked":
            setState("token_revoked");
            break;
          case "token_mismatch":
            setState("token_mismatch");
            break;
          case "access_denied":
            setState("access_denied");
            break;
          case "event_not_found":
            setState("event_not_found");
            break;
          case "event_unpublished":
            setState("event_unpublished");
            break;
          case "auth_required":
            setState("auth_required");
            break;
          default:
            setState("error");
        }
      } catch (err) {
        console.error("[LiveAccessEntry] validate error:", err);
        setState("error");
      }
    };

    validate();
  }, [token, session, navigate]);

  if (state === "loading" || state === "redirecting") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {state === "redirecting" ? "Перенаправляем на эфир..." : "Проверяем ссылку..."}
          </p>
        </div>
      </div>
    );
  }

  const stateConfig: Record<string, { icon: React.ReactNode; title: string; description: string }> = {
    token_not_found: {
      icon: <AlertTriangle className="h-16 w-16 text-muted-foreground" />,
      title: "Ссылка не найдена",
      description: "Пригласительная ссылка не найдена. Проверьте правильность ссылки или обратитесь в поддержку.",
    },
    already_used: {
      icon: <Ban className="h-16 w-16 text-muted-foreground" />,
      title: "Ссылка уже использована",
      description: "Эта пригласительная ссылка уже была использована. Каждая ссылка действует только один раз.",
    },
    token_expired: {
      icon: <Clock className="h-16 w-16 text-muted-foreground" />,
      title: "Ссылка истекла",
      description: "Срок действия пригласительной ссылки истёк. Обратитесь в поддержку для получения новой.",
    },
    token_revoked: {
      icon: <ShieldX className="h-16 w-16 text-muted-foreground" />,
      title: "Ссылка отозвана",
      description: "Эта пригласительная ссылка была отозвана администратором.",
    },
    token_mismatch: {
      icon: <UserX className="h-16 w-16 text-destructive" />,
      title: "Ссылка предназначена другому пользователю",
      description: "Эта пригласительная ссылка была выдана другому пользователю. Каждая ссылка персональная.",
    },
    access_denied: {
      icon: <Lock className="h-16 w-16 text-muted-foreground" />,
      title: "Доступ ограничен",
      description: "У вас нет доступа к этому эфиру. Убедитесь, что у вас есть активная подписка на соответствующий продукт.",
    },
    event_not_found: {
      icon: <AlertTriangle className="h-16 w-16 text-muted-foreground" />,
      title: "Эфир не найден",
      description: "Эфир, на который ведёт эта ссылка, не найден.",
    },
    event_unpublished: {
      icon: <AlertTriangle className="h-16 w-16 text-muted-foreground" />,
      title: "Эфир недоступен",
      description: "Этот эфир ещё не опубликован. Пожалуйста, дождитесь анонса.",
    },
    auth_required: {
      icon: <Lock className="h-16 w-16 text-primary" />,
      title: "Необходима авторизация",
      description: "Для доступа по пригласительной ссылке необходимо войти в аккаунт.",
    },
    error: {
      icon: <AlertTriangle className="h-16 w-16 text-destructive" />,
      title: "Ошибка",
      description: "Произошла ошибка при проверке ссылки. Попробуйте обновить страницу.",
    },
  };

  const config = stateConfig[state] || stateConfig.error;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
      {config.icon}
      <h1 className="text-2xl font-bold text-foreground">{config.title}</h1>
      <p className="text-muted-foreground text-center max-w-md">{config.description}</p>
      {state === "auth_required" && (
        <Button
          onClick={() => {
            const returnUrl = `/live-access/${token}`;
            navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
          }}
        >
          Войти
        </Button>
      )}
      {state === "error" && (
        <Button onClick={() => window.location.reload()}>Обновить</Button>
      )}
      {(state === "access_denied" || state === "token_expired" || state === "token_revoked") && (
        <Button variant="outline" onClick={() => navigate("/products")}>
          Перейти к продуктам
        </Button>
      )}
    </div>
  );
}
