import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, Clock3, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type BusinessConnection = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  can_reply: boolean;
  is_enabled: boolean;
  rights: Record<string, unknown> | null;
  last_event_at: string;
  disconnected_at: string | null;
  last_error: string | null;
  telegram_bots: { bot_name: string; bot_username: string } | null;
};

export function TelegramBusinessAccountsTab() {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["telegram-business-connections"],
    queryFn: async () => {
      // Generated DB types are refreshed only after the migration is deployed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("telegram_business_connections")
        .select("id, first_name, last_name, username, can_reply, is_enabled, rights, last_event_at, disconnected_at, last_error, telegram_bots(bot_name, bot_username)")
        .order("last_event_at", { ascending: false });
      if (error) throw error;
      return (data || []) as BusinessConnection[];
    },
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Личные аккаунты Telegram</CardTitle>
        <CardDescription>
          Подключения Secretary Mode. Они появляются автоматически после подключения бота в Telegram Business.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div className="text-sm text-muted-foreground">Проверяем подключения…</div>}
        {error && <div className="text-sm text-destructive">Не удалось загрузить подключения</div>}
        {!isLoading && !error && data.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Telegram ещё не прислал событие подключения. Обновите webhook у бота после выкладки и переподключите бота в Telegram Business.
          </div>
        )}
        {data.map((connection) => {
          const name = [connection.first_name, connection.last_name].filter(Boolean).join(" ") || "Telegram Business";
          return (
            <div key={connection.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {name}
                  <Badge variant={connection.is_enabled ? "default" : "secondary"}>
                    {connection.is_enabled ? "Подключено" : "Отключено"}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {connection.username ? `@${connection.username} · ` : ""}
                  через @{connection.telegram_bots?.bot_username || "бот"}
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  {connection.can_reply ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  {connection.can_reply ? "Ответы разрешены" : "Нет права отвечать"}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock3 className="h-4 w-4" />
                  Последнее событие: {new Date(connection.last_event_at).toLocaleString("ru-RU")}
                </div>
                {connection.last_error && (
                  <div className="max-w-md text-xs text-destructive">Последняя ошибка: {connection.last_error}</div>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Bot className="mt-0.5 h-4 w-4 shrink-0" />
          Пароли и пользовательские Telegram-сессии не сохраняются. Доступ можно отозвать в Telegram Business.
        </div>
      </CardContent>
    </Card>
  );
}
