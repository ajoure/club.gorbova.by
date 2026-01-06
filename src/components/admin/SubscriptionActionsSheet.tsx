import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  CreditCard,
  Clock,
  Ban,
  RotateCcw,
  Plus,
  Minus,
  Check,
  User,
} from "lucide-react";

interface SubscriptionActionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: {
    id: string;
    user_id: string;
    status: string;
    is_trial: boolean;
    access_start_at: string;
    access_end_at: string | null;
    trial_end_at: string | null;
    cancel_at: string | null;
    next_charge_at: string | null;
    products_v2?: { name: string; code: string } | null;
    tariffs?: { name: string; code: string } | null;
  } | null;
}

export function SubscriptionActionsSheet({
  open,
  onOpenChange,
  subscription,
}: SubscriptionActionsSheetProps) {
  const queryClient = useQueryClient();
  const [extendDays, setExtendDays] = useState(30);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch user profile
  const { data: profile } = useQuery({
    queryKey: ["profile", subscription?.user_id],
    queryFn: async () => {
      if (!subscription?.user_id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("email, full_name, phone")
        .eq("user_id", subscription.user_id)
        .single();
      return data;
    },
    enabled: !!subscription?.user_id,
  });

  const adminActionMutation = useMutation({
    mutationFn: async ({ action, data }: { action: string; data?: Record<string, any> }) => {
      if (!subscription) throw new Error("No subscription");
      
      const { data: result, error } = await supabase.functions.invoke("subscription-admin-actions", {
        body: {
          action,
          subscription_id: subscription.id,
          ...data,
        },
      });

      if (error) throw error;
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, variables) => {
      const messages: Record<string, string> = {
        cancel: "Подписка отменена",
        resume: "Подписка восстановлена",
        extend: `Доступ продлён на ${extendDays} дней`,
        grant_access: "Доступ выдан",
        revoke_access: "Доступ отозван",
        pause: "Подписка приостановлена",
      };
      toast.success(messages[variables.action] || "Действие выполнено");
      queryClient.invalidateQueries({ queryKey: ["subscriptions-v2"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleAction = async (action: string, data?: Record<string, any>) => {
    setIsProcessing(true);
    try {
      await adminActionMutation.mutateAsync({ action, data });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!subscription) return null;

  const product = subscription.products_v2;
  const tariff = subscription.tariffs;
  const isCanceled = !!subscription.cancel_at;
  const isActive = subscription.status === "active" || subscription.status === "trial";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pr-10">
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Управление подпиской
          </SheetTitle>
          <SheetDescription>
            {product?.name || "Подписка"} — {tariff?.name || ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* User info */}
          {profile && (
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Пользователь</span>
              </div>
              <div className="text-sm space-y-1">
                <p>{profile.full_name || "—"}</p>
                <p className="text-muted-foreground">{profile.email}</p>
                {profile.phone && <p className="text-muted-foreground">{profile.phone}</p>}
              </div>
            </div>
          )}

          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Статус:</span>
            <Badge variant={isActive ? "default" : "secondary"}>
              {subscription.status}
            </Badge>
            {subscription.is_trial && (
              <Badge variant="outline">Trial</Badge>
            )}
            {isCanceled && (
              <Badge variant="destructive">Отменена</Badge>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Начало доступа</p>
              <p className="font-medium">
                {format(new Date(subscription.access_start_at), "d MMMM yyyy", { locale: ru })}
              </p>
            </div>
            {subscription.access_end_at && (
              <div>
                <p className="text-muted-foreground">Конец доступа</p>
                <p className="font-medium">
                  {format(new Date(subscription.access_end_at), "d MMMM yyyy", { locale: ru })}
                </p>
              </div>
            )}
            {subscription.next_charge_at && (
              <div>
                <p className="text-muted-foreground">Следующее списание</p>
                <p className="font-medium flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  {format(new Date(subscription.next_charge_at), "d MMMM yyyy", { locale: ru })}
                </p>
              </div>
            )}
            {subscription.cancel_at && (
              <div>
                <p className="text-muted-foreground">Дата отмены</p>
                <p className="font-medium text-destructive">
                  {format(new Date(subscription.cancel_at), "d MMMM yyyy", { locale: ru })}
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Extend access */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Продлить доступ
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={extendDays}
                onChange={(e) => setExtendDays(parseInt(e.target.value) || 0)}
                min={1}
                max={365}
                className="w-24"
              />
              <span className="flex items-center text-sm text-muted-foreground">дней</span>
              <Button
                onClick={() => handleAction("extend", { days: extendDays })}
                disabled={isProcessing || extendDays < 1}
                className="flex-1"
              >
                {isProcessing ? <Clock className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                Продлить
              </Button>
            </div>
            {subscription.access_end_at && (
              <p className="text-xs text-muted-foreground">
                Новая дата: {format(addDays(new Date(subscription.access_end_at), extendDays), "d MMMM yyyy", { locale: ru })}
              </p>
            )}
          </div>

          <Separator />

          {/* Quick actions */}
          <div className="space-y-3">
            <Label>Быстрые действия</Label>
            <div className="grid grid-cols-2 gap-2">
              {isCanceled ? (
                <Button
                  variant="outline"
                  onClick={() => handleAction("resume")}
                  disabled={isProcessing}
                  className="gap-1"
                >
                  <RotateCcw className="h-4 w-4" />
                  Восстановить
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => handleAction("cancel")}
                  disabled={isProcessing}
                  className="gap-1"
                >
                  <Ban className="h-4 w-4" />
                  Отменить
                </Button>
              )}
              
              <Button
                variant="outline"
                onClick={() => handleAction("pause")}
                disabled={isProcessing || subscription.status === "paused"}
                className="gap-1"
              >
                <Clock className="h-4 w-4" />
                Приостановить
              </Button>
            </div>
          </div>

          <Separator />

          {/* Access control */}
          <div className="space-y-3">
            <Label>Управление доступом</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="default"
                onClick={() => handleAction("grant_access")}
                disabled={isProcessing}
                className="gap-1"
              >
                <Check className="h-4 w-4" />
                Выдать доступ
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleAction("revoke_access")}
                disabled={isProcessing}
                className="gap-1"
              >
                <Minus className="h-4 w-4" />
                Отозвать доступ
              </Button>
            </div>
          </div>

          {/* Subscription ID */}
          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              ID подписки: <code className="bg-muted px-1 rounded">{subscription.id}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              User ID: <code className="bg-muted px-1 rounded">{subscription.user_id.slice(0, 8)}...</code>
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
