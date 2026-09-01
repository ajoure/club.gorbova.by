import { useState, useMemo, useEffect } from "react";
import { format, addDays, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar as CalendarIcon, Shield, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { usePermissions } from "@/hooks/usePermissions";
import { buildGrantAccessBody, confirmedGrantIds, localDateTimeValue, parseLocalDateTime, verifyGrantAccessReadback } from "@/lib/grantAccessForm";

interface GrantAccessFromDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: {
    id: string;
    order_number: string;
    user_id: string | null;
    profile_id: string | null;
    product_id: string;
    tariff_id: string | null;
    status: string;
    created_at?: string;
    deal_date?: string | null;
  };
  tariff?: { access_days: number; name: string } | null;
  existingSubscription?: { 
    id: string;
    access_end_at: string | null;
    status: string;
    product_id?: string;
    tariff_id?: string | null;
  } | null;
  onSuccess: () => void;
  initialExactEnd?: boolean;
}

export function GrantAccessFromDealDialog({
  open,
  onOpenChange,
  deal,
  tariff,
  existingSubscription,
  onSuccess,
  initialExactEnd = false,
}: GrantAccessFromDealDialogProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const [customDays, setCustomDays] = useState<number | null>(null);
  const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
  const [extendFromCurrent, setExtendFromCurrent] = useState(true);
  const [grantTelegram, setGrantTelegram] = useState(true);
  const [grantGetcourse, setGrantGetcourse] = useState(true);
  const [useExactEnd, setUseExactEnd] = useState(initialExactEnd);
  const [exactEndValue, setExactEndValue] = useState("");
  const exactEnd = useMemo(() => parseLocalDateTime(exactEndValue), [exactEndValue]);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Do not preview another tariff or silently choose one of two active chains.
  const { data: productSubscriptions = [], isLoading: subscriptionLoading, isError: subscriptionError } = useQuery({
    queryKey: ["product-subscription", deal.user_id, deal.product_id, deal.tariff_id, "grant-access"],
    queryFn: async () => {
      if (!deal.user_id || !deal.product_id) return [];
      let query = supabase
        .from("subscriptions_v2")
        .select("id, access_end_at, status, product_id, tariff_id")
        .eq("user_id", deal.user_id)
        .eq("product_id", deal.product_id)
        .eq("status", "active");
      query = deal.tariff_id ? query.eq("tariff_id", deal.tariff_id) : query.is("tariff_id", null);
      const { data, error } = await query
        .order("access_end_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!deal.user_id && !!deal.product_id,
  });
  const productSubscription = productSubscriptions.length === 1 ? productSubscriptions[0] : null;
  // An expired subscription is usable only with an explicit same-deal lineage
  // supplied by the sheet, never by choosing the latest historical row.
  const expiredLinkedSubscription = productSubscriptions.length === 0 && existingSubscription?.status === 'expired'
    && existingSubscription.product_id === deal.product_id && existingSubscription.tariff_id === deal.tariff_id
    ? existingSubscription : null;
  const exactSubscription = productSubscription || expiredLinkedSubscription;
  const exactCurrentEnd = exactSubscription?.access_end_at && Number.isFinite(Date.parse(exactSubscription.access_end_at))
    ? new Date(exactSubscription.access_end_at) : null;

  // Set default start date from deal_date (canonical) when dialog opens
  const dealDate = deal.deal_date || deal.created_at;
  useEffect(() => {
    if (open && dealDate) {
      setCustomStartDate(new Date(dealDate));
    } else if (open) {
      setCustomStartDate(new Date());
    }
    if (open) {
      setUseExactEnd(initialExactEnd);
      setExactEndValue("");
      setExtendFromCurrent(true);
      setCustomDays(null);
      setGrantTelegram(true);
      setGrantGetcourse(true);
    }
  }, [open, deal.id, dealDate, initialExactEnd]);

  // Calculate access period
  const accessDays = customDays ?? tariff?.access_days ?? 30;
  
  const calculation = useMemo(() => {
    const now = new Date();
    const activeSub = productSubscription || existingSubscription;
    
    // Base date: customStartDate or deal_date or now
    const dealDateVal = deal.deal_date || deal.created_at;
    const baseDate = customStartDate || (dealDateVal ? new Date(dealDateVal) : now);
    
    // Check if there's active access to extend from
    const hasActiveAccess = activeSub?.status === "active" && 
      activeSub?.access_end_at && 
      new Date(activeSub.access_end_at) > now;
    
    let startDate: Date;
    if (extendFromCurrent && hasActiveAccess && activeSub?.access_end_at) {
      startDate = new Date(activeSub.access_end_at);
    } else {
      startDate = baseDate;
    }
    
    const endDate = useExactEnd ? exactEnd : addDays(startDate, accessDays);
    
    // Calculate remaining days if extending
    const remainingDays = hasActiveAccess && activeSub?.access_end_at
      ? differenceInDays(new Date(activeSub.access_end_at), now)
      : 0;
    
    // Check if start date is in the past
    const isStartInPast = startDate < now;
    
    return {
      startDate,
      endDate,
      hasActiveAccess,
      remainingDays,
      totalDays: accessDays + (extendFromCurrent ? remainingDays : 0),
      currentEndDate: activeSub?.access_end_at ? new Date(activeSub.access_end_at) : null,
      isStartInPast,
    };
  }, [accessDays, extendFromCurrent, productSubscription, existingSubscription, customStartDate, deal.created_at, deal.deal_date, useExactEnd, exactEnd]);

  const exactError = useExactEnd ? (
    !exactSubscription ? "Не подтверждена единственная существующая подписка этого тарифа. Обновите данные сделки."
      : !exactEnd ? "Укажите корректную точную дату и время окончания."
      : exactEnd <= new Date() ? "Точная дата окончания должна быть в будущем."
      : !exactSubscription.access_end_at || !Number.isFinite(Date.parse(exactSubscription.access_end_at))
        ? "Текущий срок подписки не подтверждён. Требуется ручная проверка."
      : exactEnd.getTime() < Date.parse(exactSubscription.access_end_at) ? "Этот режим не сокращает существующий доступ." : null
  ) : null;
  const canGrant = isAdmin() && !!deal.user_id && (deal.status === "paid" || deal.status === "partial")
    && !subscriptionLoading && !subscriptionError && productSubscriptions.length <= 1 && !exactError
    && (useExactEnd ? deal.status === "paid" : (Number.isInteger(accessDays) && accessDays > 0));

  // Grant access mutation
  const grantAccessMutation = useMutation({
    mutationFn: async () => {
      if (!canGrant || !deal.user_id) throw new Error("Выдача доступа недоступна: проверьте роль и данные сделки.");
      const requestedEnd = useExactEnd ? exactEnd : null;
      const expectedId = useExactEnd ? exactSubscription?.id : undefined;
      if (useExactEnd) {
        const capability = await supabase.functions.invoke('grant-access-for-order', { method: 'GET' });
        if (capability.error || capability.data?.capabilities?.exact_existing_access_v1 !== true) {
          throw new Error('Сервер ещё не поддерживает безопасную точную правку. Выдача не запускалась; дождитесь обновления.');
        }
      }
      const { data, error } = await supabase.functions.invoke("grant-access-for-order", {
        body: buildGrantAccessBody({
          orderId: deal.id,
          days: customDays,
          start: useExactEnd ? exactCurrentEnd : customStartDate,
          extendFromCurrent,
          grantTelegram,
          grantGetcourse,
          exactEnd: requestedEnd,
          expectedExistingSubscriptionId: expectedId,
        }),
      });
      if (error) throw error;
      const ids = confirmedGrantIds(data);
      const [subResult, entResult] = await Promise.all([
        supabase.from("subscriptions_v2").select("id,user_id,product_id,tariff_id,order_id,status,access_end_at,meta")
          .eq("id", ids.subscriptionId).maybeSingle(),
        supabase.from("entitlements").select("id,user_id,product_id,order_id,status,expires_at,meta")
          .eq("id", ids.entitlementId).maybeSingle(),
      ]);
      if (subResult.error || entResult.error) throw new Error("Не удалось перепроверить выданный доступ. Проверьте историю сделки перед повтором.");
      const verifiedEnd = verifyGrantAccessReadback({
        orderId: deal.id, userId: deal.user_id, productId: deal.product_id, tariffId: deal.tariff_id,
        subscription: subResult.data, entitlement: entResult.data,
        minimumEnd: requestedEnd, expectedExistingSubscriptionId: expectedId,
      });
      return { verifiedEnd, integrationsIncomplete: ids.integrationsIncomplete, integrationsPending: ids.integrationsPending };
    },
    onSuccess: (data) => {
      toast.success("Срок доступа подтверждён", {
        description: `До ${format(data.verifiedEnd, "dd.MM.yyyy HH:mm:ss.SSS")} (${timeZone})`,
      });
      if (data.integrationsIncomplete) toast.warning("Доступ выдан, но интеграция не завершена. Проверьте Telegram / GetCourse в истории сделки.");
      else if (data.integrationsPending) toast.info("Срок доступа подтверждён. Подключение Telegram / GetCourse ещё обрабатывается.");
      queryClient.invalidateQueries({ queryKey: ["deal-subscription", deal.id] });
      queryClient.invalidateQueries({ queryKey: ["product-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["deal-audit", deal.id] });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error("Ошибка выдачи доступа", {
        description: normalizeEdgeFunctionError(error),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["product-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["deal-subscription", deal.id] });
      queryClient.invalidateQueries({ queryKey: ["contact-subscriptions"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] flex-col overflow-hidden sm:max-w-[480px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Выдать доступ
          </DialogTitle>
          <DialogDescription>
            Сделка #{deal.order_number}
          </DialogDescription>
        </DialogHeader>

        <div data-testid="grant-access-scroll-body" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={grantAccessMutation.isPending} className="min-w-0 space-y-4 py-4 pr-1">
          {!isAdmin() && <p role="alert" className="text-sm text-destructive">Выдавать доступ может только администратор.</p>}
          {(subscriptionError || productSubscriptions.length > 1) && <p role="alert" className="text-sm text-destructive">
            Не удалось однозначно подтвердить подписку. Обновите данные и проверьте связь сделки.
          </p>}
          {/* Warnings */}
          {!deal.user_id && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Пользователь не привязан</p>
                <p className="text-muted-foreground">Сначала привяжите контакт к сделке</p>
              </div>
            </div>
          )}

          {deal.status !== "paid" && deal.status !== "partial" && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Сделка не оплачена</p>
                <p className="text-muted-foreground">Статус: {deal.status}</p>
              </div>
            </div>
          )}

          {/* Tariff info */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Тариф</span>
              <Badge variant="outline" className="max-w-full break-words whitespace-normal">{tariff?.name || "Не указан"}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Дней по тарифу</span>
              <span className="font-medium">{tariff?.access_days || 30}</span>
            </div>
          </div>

          {/* Current access info */}
          {calculation.hasActiveAccess && calculation.currentEndDate && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Активный доступ</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Текущий доступ до</span>
                <span className="text-right">{format(calculation.currentEndDate, "dd.MM.yyyy HH:mm:ss.SSS")}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Осталось дней</span>
                <span>{calculation.remainingDays}</span>
              </div>
            </div>
          )}

          <Separator />

          {/* Custom start date */}
          {!useExactEnd && <div className="space-y-2">
            <Label>Дата начала доступа</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !customStartDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customStartDate ? format(customStartDate, "dd MMMM yyyy", { locale: ru }) : "Выберите дату"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customStartDate || undefined}
                  onSelect={(date) => setCustomStartDate(date || null)}
                  locale={ru}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            {calculation.isStartInPast && (
              <p className="text-xs text-amber-600">
                ⚠️ Дата начала в прошлом — доступ будет выдан ретроактивно
              </p>
            )}
          </div>}

          <div className="flex items-center gap-2">
            <Checkbox id="exactAccessEnd" checked={useExactEnd} onCheckedChange={(checked) => {
              setUseExactEnd(!!checked);
              if (checked) setExtendFromCurrent(true);
            }} />
            <Label htmlFor="exactAccessEnd" className="cursor-pointer">Точная дата окончания</Label>
          </div>
          {useExactEnd ? <div className="space-y-2">
            <Label htmlFor="exactAccessEndValue">Дата и время окончания</Label>
            <Input id="exactAccessEndValue" type="datetime-local" step="0.001" value={exactEndValue}
              onChange={(event) => setExactEndValue(event.target.value)} className="min-w-0 max-w-full" />
            <Button type="button" variant="outline" size="sm"
              disabled={!exactCurrentEnd || subscriptionLoading || subscriptionError || productSubscriptions.length > 1
                || !Number.isFinite(accessDays) || accessDays <= 0}
              onClick={() => {
                if (!exactCurrentEnd || !Number.isFinite(accessDays) || accessDays <= 0) return;
                setExactEndValue(localDateTimeValue(new Date(exactCurrentEnd.getTime() + accessDays * 86_400_000)));
              }}>
              Добавить {accessDays} дней по тарифу
            </Button>
            <p className="break-words text-xs text-muted-foreground">Часовой пояс: {timeZone}. Продление существующего доступа без новой оплаты; график списаний провайдера не меняется.</p>
            {exactError && <p role="alert" className="text-sm text-destructive">{exactError}</p>}
          </div> : <div className="space-y-2">
            <Label htmlFor="customDays">Количество дней доступа</Label>
            <Input
              id="customDays"
              type="number"
              min={1}
              max={365}
              value={customDays ?? tariff?.access_days ?? 30}
              onChange={(e) => setCustomDays(e.target.value ? parseInt(e.target.value) : null)}
              placeholder={String(tariff?.access_days || 30)}
            />
          </div>}

          {/* Extend from current */}
          {calculation.hasActiveAccess && !useExactEnd && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="extendFromCurrent"
                checked={extendFromCurrent}
                onCheckedChange={(checked) => setExtendFromCurrent(!!checked)}
              />
              <Label htmlFor="extendFromCurrent" className="text-sm cursor-pointer">
                Продлить от конца текущего доступа
              </Label>
            </div>
          )}

          {/* Integration options */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Интеграции</Label>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="grantTelegram"
                checked={grantTelegram}
                onCheckedChange={(checked) => setGrantTelegram(!!checked)}
              />
              <Label htmlFor="grantTelegram" className="text-sm cursor-pointer">
                Выдать доступ в Telegram
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="grantGetcourse"
                checked={grantGetcourse}
                onCheckedChange={(checked) => setGrantGetcourse(!!checked)}
              />
              <Label htmlFor="grantGetcourse" className="text-sm cursor-pointer">
                Синхронизировать с GetCourse
              </Label>
            </div>
          </div>

          <Separator />

          {/* Result preview */}
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <CalendarIcon className="w-4 h-4" />
              <span className="text-sm font-medium">Результат</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{useExactEnd ? "Текущая граница доступа" : "Начало доступа"}</span>
              <span>{useExactEnd
                ? exactCurrentEnd ? format(exactCurrentEnd, "dd.MM.yyyy HH:mm:ss.SSS") : "Не подтверждена"
                : format(calculation.startDate, "dd.MM.yyyy HH:mm:ss.SSS")}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Конец доступа</span>
              <span className="font-medium">{calculation.endDate ? format(calculation.endDate, "dd.MM.yyyy HH:mm:ss.SSS") : "Не задан"}</span>
            </div>
            {useExactEnd ? <p className="break-words text-xs text-muted-foreground">
              {timeZone}{exactEnd ? ` · UTC: ${exactEnd.toISOString()}` : ""}. Историческое начало существующей подписки сохраняется.
            </p> : <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Всего дней</span>
              <Badge variant="secondary">
                {extendFromCurrent && calculation.hasActiveAccess 
                  ? `${calculation.remainingDays} + ${accessDays} = ${calculation.totalDays}`
                  : accessDays
                }
              </Badge>
            </div>}
          </div>
        </fieldset>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => grantAccessMutation.mutate()}
            disabled={!canGrant || grantAccessMutation.isPending}
          >
            {grantAccessMutation.isPending ? (
              <>
                <Clock className="w-4 h-4 mr-2 animate-spin" />
                Выдаётся...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 mr-2" />
                Выдать доступ
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
