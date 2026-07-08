import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "already" }
  | { kind: "ready" }
  | { kind: "confirming" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    document.title = "Отписка от рассылки";
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
    fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (r.status === 404) return setState({ kind: "invalid" });
        if (data?.valid === false || data?.reason === "already_unsubscribed") {
          return setState({ kind: "already" });
        }
        if (data?.valid === true) return setState({ kind: "ready" });
        return setState({ kind: "invalid" });
      })
      .catch((e) => setState({ kind: "error", message: String(e) }));
  }, [token]);

  async function confirm() {
    if (!token) return;
    setState({ kind: "confirming" });
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
      body: { token },
    });
    if (error) return setState({ kind: "error", message: error.message });
    if ((data as any)?.success) return setState({ kind: "done" });
    if ((data as any)?.reason === "already_unsubscribed") return setState({ kind: "already" });
    setState({ kind: "error", message: "Не удалось выполнить отписку" });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Отписка от писем</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.kind === "loading" && <p>Проверяем ссылку…</p>}
          {state.kind === "invalid" && (
            <p className="text-muted-foreground">
              Ссылка недействительна или уже использована.
            </p>
          )}
          {state.kind === "already" && (
            <p className="text-muted-foreground">
              Вы уже отписались от рассылки. Больше писем не придёт.
            </p>
          )}
          {state.kind === "ready" && (
            <>
              <p>
                Подтвердите, что вы хотите отписаться от уведомлений на этот
                адрес.
              </p>
              <Button onClick={confirm} className="w-full">
                Отписаться
              </Button>
            </>
          )}
          {state.kind === "confirming" && <p>Обрабатываем…</p>}
          {state.kind === "done" && (
            <p className="text-green-700">
              Готово. Вы отписаны от нашей рассылки.
            </p>
          )}
          {state.kind === "error" && (
            <p className="text-red-600 text-sm">Ошибка: {state.message}</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
