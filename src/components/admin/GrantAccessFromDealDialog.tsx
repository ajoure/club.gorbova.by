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
    created_at?: string;  // Deal creation date (should be payment date)
  };
  tariff?: { access_days: number; name: string } | null;
  existingSubscription?: { 
    id: string;
    access_end_at: string | null;
    status: string;
    product_id?: string;
  } | null;
  onSuccess: () => void;
}

export function GrantAccessFromDealDialog({
  open,
  onOpenChange,
  deal,
  tariff,
  existingSubscription,
  onSuccess,
}: GrantAccessFromDealDialogProps) {
  const queryClient = useQueryClient();
  const [customDays, setCustomDays] = useState<number | null>(null);
  const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
  const [extendFromCurrent, setExtendFromCurrent] = useState(true);
  const [grantTelegram, setGrantTelegram] = useState(true);
  const [grantGetcourse, setGrantGetcourse] = useState(true);

  // Fetch existing active subscription for this product (not just this order)
  const { data: productSubscription } = useQuery({
    queryKey: ["product-subscription", deal.user_id, deal.product_id],
    queryFn: async () => {
      if (!deal.user_id || !deal.product_id) return null;
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("id, access_end_at, status, product_id")
        .eq("user_id", deal.user_id)
        .eq("product_id", deal.product_id)
        .eq("status", "active")
        .order("access_end_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: open && !!deal.user_id && !!deal.product_id,
  });

  // Set default start date from deal.created_at when dialog opens
  useEffect(() => {
    if (open && deal.created_at) {
      setCustomStartDate(new Date(deal.created_at));
    } else if (open) {
      setCustomStartDate(new Date());
    }
  }, [open, deal.created_at]);

  // Calculate access period
  const accessDays = customDays ?? tariff?.access_days ?? 30;
  
  const calculation = useMemo(() => {
    const now = new Date();
    const activeSub = productSubscription || existingSubscription;
    
    // Base date: customStartDate or deal.created_at or now
    const baseDate = customStartDate || (deal.created_at ? new Date(deal.created_at) : now);
    
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
    
    const endDate = addDays(startDate, accessDays);
    
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
  }, [accessDays, extendFromCurrent, productSubscription, existingSubscription, customStartDate, deal.created_at]);

  // Grant access mutation
  const grantAccessMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("grant-access-for-order", {
        body: {
          orderId: deal.id,
          customAccessDays: customDays,
          customAccessStartAt: customStartDate?.toISOString(),  // Pass custom start date
          extendFromCurrent,
          grantTelegram,
          grantGetcourse,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success("Доступ успешно выдан", {
        description: `До ${format(calculation.endDate, "dd MMMM yyyy", { locale: ru })}`,
      });
      queryClient.invalidateQueries({ queryKey: ["deal-subscription", deal.id] });
      queryClient.invalidateQueries({ queryKey: ["product-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["deal-audit", deal.id] });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error("Ошибка выдачи доступа", {
        description: error.message,
      });
    },
  });

  const canGrant = deal.user_id && (deal.status === "paid" || deal.status === "partial");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Выдать доступ
          </DialogTitle>
          <DialogDescription>
            Сделка #{deal.order_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Тариф</span>
              <Badge variant="outline">{tariff?.name || "Не указан"}</Badge>
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
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Текущий доступ до</span>
                <span>{format(calculation.currentEndDate, "dd.MM.yyyy")}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Осталось дней</span>
                <span>{calculation.remainingDays}</span>
              </div>
            </div>
          )}

          <Separator />

          {/* Custom start date */}
          <div className="space-y-2">
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
          </div>

          {/* Custom days */}
          <div className="space-y-2">
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
          </div>

          {/* Extend from current */}
          {calculation.hasActiveAccess && (
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
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Начало доступа</span>
              <span>{format(calculation.startDate, "dd.MM.yyyy")}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Конец доступа</span>
              <span className="font-medium">{format(calculation.endDate, "dd.MM.yyyy")}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Всего дней</span>
              <Badge variant="secondary">
                {extendFromCurrent && calculation.hasActiveAccess 
                  ? `${calculation.remainingDays} + ${accessDays} = ${calculation.totalDays}`
                  : accessDays
                }
              </Badge>
            </div>
          </div>
        </div>

        <DialogFooter>
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
