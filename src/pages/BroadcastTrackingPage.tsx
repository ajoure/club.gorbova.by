import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { isForbiddenRedirectUrl } from "@/utils/publicAppHost";

type State = "loading" | "error";

/**
 * Public same-domain wrapper for broadcast links.
 * The browser stays on gorbova.by while the opaque token is resolved by the
 * backend; the Supabase function hostname is never exposed as the clicked URL.
 */
export default function BroadcastTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
        setState("error");
        return;
      }

      try {
        const backend = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
        const response = await fetch(
          `${backend}/functions/v1/broadcast-track/c/${encodeURIComponent(token)}?format=json`,
          { headers: { Accept: "application/json" }, cache: "no-store" },
        );
        const payload = await response.json().catch(() => null) as { url?: string } | null;
        if (!response.ok || !payload?.url || isForbiddenRedirectUrl(payload.url)) {
          throw new Error("tracking_target_unavailable");
        }
        if (!cancelled) window.location.replace(payload.url);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-3">
        {state === "loading" ? (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Открываем страницу…</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Ссылка недоступна</h1>
            <p className="text-muted-foreground">Проверьте ссылку или обратитесь в службу поддержки.</p>
          </>
        )}
      </div>
    </main>
  );
}
