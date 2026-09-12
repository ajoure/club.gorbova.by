import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Pause, Play, Settings2 } from "lucide-react";
import { toast } from "sonner";

type Status = {
  scope?: { user_id: string; business_account_id: string };
  available: boolean;
  can_configure?: boolean;
  ai_models?: string[];
  catalog_products?: {id:string;name:string}[];
  campaign?: {
    mode: string;
    trigger_phrase: string;
    delay_min_seconds: number;
    delay_max_seconds: number;
    ai_config?: {model:string;max_tokens:number;timeout_seconds:number;max_context_chars:number;vision_enabled:boolean;max_image_bytes:number};
    consultation_product_ids?: string[];
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
    [ai,setAi]=useState<Status['campaign']['ai_config']>(),
    [productIds,setProductIds]=useState<string[]>([]),
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
    setAi(undefined);
    setProductIds([]);
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
  useEffect(()=>{if(!settings)setAi(query.data?.campaign?.ai_config)},[settings,query.data?.campaign?.ai_config]);
  useEffect(()=>{if(!settings)setProductIds(query.data?.campaign?.consultation_product_ids??[])},[settings,query.data?.campaign?.consultation_product_ids]);
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
    <Dialog open={settings} onOpenChange={setSettings}>
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
            <DialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Настройки задержки автопродаж"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            </DialogTrigger>
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
    </section>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader className="pr-6">
        <DialogTitle>Настройки автопродаж</DialogTitle>
        <DialogDescription>Задержка ответов, модель ИИ и продукты для консультации.</DialogDescription>
      </DialogHeader>
        <div className="space-y-2">
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
            После вопроса бот ждёт клиента. Возможно одно напоминание в разрешённое время.
            Продолжение сохраняет контекст.
          </p>
          {ai && <div className="space-y-2 border-t pt-2">
            <label className="block text-xs">Модель для диалога и скриншотов
              <select aria-label="Модель автопродаж" className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={ai.model}
                disabled={enabled} onChange={e=>setAi({...ai,model:e.target.value})}>
                {(query.data.ai_models??[ai.model]).map(model=><option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ai.vision_enabled} disabled={enabled}
              onChange={e=>setAi({...ai,vision_enabled:e.target.checked})}/>Читать скриншоты клиента</label>
            <div className="flex flex-wrap gap-2">
              <label className="text-xs">Лимит ответа ИИ<Input aria-label="Лимит ответа ИИ" type="number" className="w-28" value={ai.max_tokens} min={2000} max={16000} disabled={enabled} onChange={e=>setAi({...ai,max_tokens:+e.target.value})}/></label>
              <label className="text-xs">Ожидание ИИ, секунд<Input aria-label="Ожидание ИИ" type="number" className="w-28" value={ai.timeout_seconds} min={15} max={90} disabled={enabled} onChange={e=>setAi({...ai,timeout_seconds:+e.target.value})}/></label>
            </div>
            <p className="text-xs text-muted-foreground">Для смены модели выключите автопродажи. История сохраняется. Неразборчивое вложение передаётся человеку.</p>
            <Button size="sm" variant="outline" disabled={enabled||mutation.isPending||conversation?.state!=='HUMAN_HOLD'||!Number.isInteger(ai.max_tokens)||ai.max_tokens<2000||ai.max_tokens>16000||!Number.isInteger(ai.timeout_seconds)||ai.timeout_seconds<15||ai.timeout_seconds>90}
              onClick={()=>mutation.mutate({action:'ai_config',ai_config:ai,expected_ai_config:campaign.ai_config})}>Сохранить настройки ИИ</Button>
          </div>}
          {!!query.data.catalog_products?.length&&<div className="space-y-2 border-t pt-2">
            <p className="text-xs font-medium">Другие продукты для консультации</p>
            <p className="text-xs text-muted-foreground">Выберите до 20 продуктов. Условия читаются из текущих публичных тарифов. Обучающие материалы клиенту не выдаются.</p>
            <div className="max-h-44 overflow-y-auto space-y-2">
              {query.data.catalog_products.map(product=><label key={product.id} className="flex items-start gap-2 text-xs break-words">
                <input type="checkbox" aria-label={`Консультировать: ${product.name}`} checked={productIds.includes(product.id)} disabled={enabled}
                  onChange={e=>setProductIds(e.target.checked?[...productIds,product.id]:productIds.filter(id=>id!==product.id))}/>{product.name}
              </label>)}
            </div>
            <Button size="sm" variant="outline" disabled={enabled||mutation.isPending||conversation?.state!=='HUMAN_HOLD'||productIds.length>20}
              onClick={()=>mutation.mutate({action:'knowledge_products',product_ids:productIds,expected_product_ids:campaign.consultation_product_ids??[]})}>Сохранить продукты</Button>
          </div>}
        </div>
    </DialogContent>
    </Dialog>
  );
}
