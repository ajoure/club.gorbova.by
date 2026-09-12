import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pause, Play, Settings2 } from "lucide-react";
import { toast } from "sonner";

type Status = {
  scope?: { user_id: string; business_account_id: string };
  available: boolean;
  can_configure?: boolean;
  campaign?: {
    mode: string;
    trigger_phrase: string;
    delay_min_seconds: number;
    delay_max_seconds: number;
  };
  conversation?: { state: string; started: boolean; reason: string | null };
  job?: { status: string; due_at: string };
};
const labels: Record<string, string> = {
  OFF: "Ждёт кодовую фразу",
  READY: "Готовит ответ",
  WAIT_CUSTOMER: "Ждёт клиента",
  HUMAN_HOLD: "На паузе",
  STOPPED: "Остановлен по просьбе клиента",
  DELIVERY_UNKNOWN: "Нужно проверить доставку",
};

export function SalesRuntimeControls(
  { userId, businessAccountId }: {
    userId: string;
    businessAccountId: string | null;
  },
) {
  const access = useAdminAccess(),
    cache = useQueryClient(),
    allowed = access.canAccessSection("communication", "manage");
  const [settings, setSettings] = useState(false),
    [min, setMin] = useState("60"),
    [max, setMax] = useState("180");
  const queryKey = ["sales-runtime", userId, businessAccountId];
  async function invoke(action: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await supabase.functions.invoke(
      "sales-runtime-control",
      {
        body: {
          action,
          user_id: userId,
          business_account_id: businessAccountId,
          ...extra,
        },
      },
    );
    if (error || data?.error) {
      throw Error(data?.message || "Не удалось обновить автопродажи");
    }
    return data as Status;
  }
  const query = useQuery({
    queryKey,
    queryFn: () => invoke("status"),
    enabled: allowed && !!businessAccountId,
    refetchInterval: 5000,
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: (
      { action, ...extra }: { action: string; [k: string]: unknown },
    ) => invoke(action, extra),
    onSuccess: (data) => {
      cache.setQueryData(
        data.scope
          ? [
            "sales-runtime",
            data.scope.user_id,
            data.scope.business_account_id,
          ]
          : queryKey,
        data,
      );
      toast.success("Настройки автопродаж обновлены");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  useEffect(() => {
    setSettings(false);
  }, [userId, businessAccountId]);
  useEffect(() => {
    if (query.data?.campaign) {
      setMin(String(query.data.campaign.delay_min_seconds));
      setMax(String(query.data.campaign.delay_max_seconds));
    }
  }, [
    query.data?.campaign?.delay_min_seconds,
    query.data?.campaign?.delay_max_seconds,
  ]);
  if (!allowed || !businessAccountId || query.isLoading) return null;
  if (query.isError) {
    return (
      <div className="text-xs text-destructive px-1 py-2" role="status">
        Статус автопродаж недоступен.{" "}
        <button
          className="underline"
          onClick={() => query.refetch()}
        >
          Обновить
        </button>
      </div>
    );
  }
  if (!query.data?.available) return null;
  const { campaign, conversation, job } = query.data,
    enabled = campaign.mode === "owner_test",
    state = conversation?.state || "OFF";
  const sending = job?.status === "sending",
    blocked = ["STOPPED", "DELIVERY_UNKNOWN"].includes(state);
  const waiting = job?.status === "queued" && enabled && state === "READY";
  const label = !enabled
    ? "Выключены"
    : waiting
    ? "Ответ ожидает отправки"
    : labels[state] || state;
  const act = (action: string) => mutation.mutate({ action });
  const validDelay = Number.isInteger(+min) && +min >= 30 && +min <= 600 &&
    Number.isInteger(+max) && +max >= +min && +max <= 900;
  return (
    <section
      data-testid="sales-runtime-controls"
      aria-label="Автопродажи ЦБ21"
      className="rounded-xl border bg-muted/30 p-2 space-y-2 min-w-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Автопродажи ЦБ21 · тест</span>
        <span
          role="status"
          className="text-xs text-muted-foreground break-words"
        >
          {label}
        </span>
        <div className="flex flex-wrap gap-1 ml-auto">
          {!enabled && query.data.can_configure && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => act("enable")}
            >
              <Play className="h-3 w-3 mr-1" />Включить
            </Button>
          )}
          {enabled && state !== "HUMAN_HOLD" && !blocked && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => act("pause")}
            >
              <Pause className="h-3 w-3 mr-1" />Пауза
            </Button>
          )}
          {enabled && state === "HUMAN_HOLD" && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending || sending}
              onClick={() => act("resume")}
            >
              <Play className="h-3 w-3 mr-1" />Продолжить
            </Button>
          )}
          {query.data.can_configure && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Настройки задержки автопродаж"
              onClick={() => setSettings(!settings)}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {waiting && (
        <p className="text-xs text-muted-foreground">
          Случайная пауза перед ответом. Новые сообщения клиента будут учтены
          вместе.
        </p>
      )}
      {enabled && state === "OFF" && (
        <p className="text-xs break-words">
          Запуск на новое сообщение: «{campaign.trigger_phrase}»
        </p>
      )}
      {sending && (
        <p className="text-xs text-amber-700">
          Ответ уже передаётся Telegram. Пауза остановит последующие ответы.
        </p>
      )}
      {blocked && (
        <p className="text-xs text-muted-foreground">
          Автоответы заблокированы. Проверьте переписку вручную.
        </p>
      )}
      {settings && (
        <div className="border-t pt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Случайная задержка перед каждым ответом, в секундах.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              От<Input
                aria-label="Минимальная задержка"
                type="number"
                min={30}
                max={600}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                className="w-20 h-8"
              />
            </label>
            <label className="text-xs">
              До<Input
                aria-label="Максимальная задержка"
                type="number"
                min={30}
                max={900}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                className="w-20 h-8"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending || !validDelay}
              onClick={() =>
                mutation.mutate({
                  action: "delay",
                  delay_min_seconds: +min,
                  delay_max_seconds: +max,
                })}
            >
              Сохранить
            </Button>
            {enabled && (
              <Button
                size="sm"
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => act("disable")}
              >
                Выключить
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Без ответа клиента бот больше не пишет. Продолжение сохраняет
            контекст.
          </p>
        </div>
      )}
    </section>
  );
}
