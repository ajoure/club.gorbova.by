import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useKinescopePlayer } from "@/hooks/useKinescopePlayer";
import { Loader2, Lock, CalendarClock, AlertTriangle, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface LiveResolveResult {
  status: "ok" | "not_found" | "unpublished" | "auth_required" | "access_denied" | "error";
  title?: string;
  description?: string;
  kinescope_video_id?: string;
  event_status?: string;
  scheduled_at?: string;
  replay_enabled?: boolean;
  message?: string;
}

type PageState = "loading" | "not_found" | "unpublished" | "access_denied" | "scheduled" | "live" | "ended_no_replay" | "error";

export default function LiveEvent() {
  const { slug } = useParams<{ slug: string }>();
  const { session } = useAuth();
  const [state, setState] = useState<PageState>("loading");
  const [data, setData] = useState<LiveResolveResult | null>(null);

  useEffect(() => {
    if (!slug || !session) return;

    const resolve = async () => {
      setState("loading");
      try {
        const { data: result, error } = await supabase.functions.invoke("live-resolve", {
          body: null,
          headers: { "Content-Type": "application/json" },
          method: "GET",
        });

        // supabase.functions.invoke wraps the response, so we need to handle it
        // Actually, for GET with query params we need to use fetch directly
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/live-resolve?slug=${encodeURIComponent(slug)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );

        const json: LiveResolveResult = await response.json();
        setData(json);

        switch (json.status) {
          case "not_found":
            setState("not_found");
            break;
          case "unpublished":
            setState("unpublished");
            break;
          case "access_denied":
            setState("access_denied");
            break;
          case "ok":
            if (json.event_status === "scheduled") {
              setState("scheduled");
            } else if (json.event_status === "ended" && !json.replay_enabled) {
              setState("ended_no_replay");
            } else {
              setState("live");
            }
            break;
          default:
            setState("error");
        }
      } catch (err) {
        console.error("[LiveEvent] resolve error:", err);
        setState("error");
      }
    };

    resolve();
  }, [slug, session]);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (state === "not_found") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Страница не найдена</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Эфир по этому адресу не найден. Проверьте ссылку или обратитесь в поддержку.
        </p>
      </div>
    );
  }

  if (state === "unpublished") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Эфир недоступен</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Этот эфир ещё не опубликован. Пожалуйста, дождитесь анонса.
        </p>
      </div>
    );
  }

  if (state === "access_denied") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Lock className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">Доступ ограничен</h1>
        {data?.title && (
          <h2 className="text-lg text-muted-foreground">{data.title}</h2>
        )}
        <p className="text-muted-foreground text-center max-w-md">
          У вас нет доступа к этому эфиру. Убедитесь, что у вас есть активная подписка на соответствующий продукт.
        </p>
        <Button variant="outline" onClick={() => window.location.href = "/products"}>
          Перейти к продуктам
        </Button>
      </div>
    );
  }

  if (state === "scheduled") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <CalendarClock className="h-16 w-16 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">{data?.title || "Эфир"}</h1>
        {data?.description && (
          <p className="text-muted-foreground text-center max-w-md">{data.description}</p>
        )}
        {data?.scheduled_at && (
          <div className="bg-primary/10 rounded-lg px-6 py-3 text-primary font-medium">
            Начало: {format(new Date(data.scheduled_at), "dd MMMM yyyy, HH:mm", { locale: ru })}
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Эфир ещё не начался. Возвращайтесь в назначенное время.
        </p>
      </div>
    );
  }

  if (state === "ended_no_replay") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Video className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold text-foreground">{data?.title || "Эфир завершён"}</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Эфир завершён. Запись пока недоступна.
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <AlertTriangle className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold text-foreground">Ошибка</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Произошла ошибка при загрузке страницы. Попробуйте обновить страницу.
        </p>
        <Button onClick={() => window.location.reload()}>Обновить</Button>
      </div>
    );
  }

  // state === "live" — show player
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">{data?.title}</h1>
        {data?.description && (
          <p className="text-muted-foreground mb-6">{data.description}</p>
        )}
        {data?.event_status === "ended" && data?.replay_enabled && (
          <div className="mb-4 inline-flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 text-sm text-muted-foreground">
            <Video className="h-4 w-4" /> Запись эфира
          </div>
        )}
        {data?.kinescope_video_id && (
          <KinescopePlayerWrapper videoId={data.kinescope_video_id} />
        )}
      </div>
    </div>
  );
}

function KinescopePlayerWrapper({ videoId }: { videoId: string }) {
  const containerId = "live-player-container";

  useKinescopePlayer({
    videoId,
    containerId,
  });

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <div id={containerId} className="w-full h-full" />
    </div>
  );
}
