import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Send, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SendNotificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userEmail: string;
  userName?: string;
}

const notificationTypes = [
  { value: "reminder_3_days", label: "Напоминание (3 дня до окончания)" },
  { value: "reminder_1_day", label: "Напоминание (1 день до окончания)" },
  { value: "welcome", label: "Приветствие" },
  { value: "access_granted", label: "Доступ выдан" },
  { value: "access_revoked", label: "Доступ отозван" },
  { value: "access_still_active_apology", label: "Извинение (ошибочный revoke)" }, // PATCH 10E
  { value: "custom", label: "Произвольное сообщение" },
];

export function SendNotificationDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
  userName,
}: SendNotificationDialogProps) {
  const [messageType, setMessageType] = useState("welcome");
  const [customMessage, setCustomMessage] = useState("");
  const [clickGuard, setClickGuard] = useState(false); // PATCH 10D: Double-click protection

  // PATCH 10D: Check user subscription status for UI guard
  const { data: userSubscription } = useQuery({
    queryKey: ['user-subscription-status-guard', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('subscriptions_v2')
        .select('id, status, access_end_at')
        .eq('user_id', userId)
        .in('status', ['active', 'trial'])
        .gt('access_end_at', new Date().toISOString())
        .order('access_end_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: open && !!userId
  });

  const hasActiveSubscription = !!userSubscription;
  const accessEndDate = userSubscription?.access_end_at 
    ? new Date(userSubscription.access_end_at).toLocaleDateString('ru-RU')
    : null;

  const sendNotification = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("telegram-send-notification", {
        body: {
          user_id: userId,
          message_type: messageType,
          custom_message: messageType === "custom" ? customMessage : undefined,
        },
      });

      if (error) throw error;
      
      // Handle blocked/skipped responses from PATCH 10A/10B
      if (data?.blocked) {
        throw new Error(data.error || 'Отправка заблокирована: у пользователя активный доступ');
      }
      if (data?.skipped) {
        throw new Error(data.error || 'Уведомление уже было отправлено недавно');
      }
      if (!data?.success) {
        throw new Error(data?.error || "Ошибка отправки");
      }
      
      return data;
    },
    onSuccess: () => {
      toast.success("Уведомление отправлено");
      onOpenChange(false);
      setMessageType("welcome");
      setCustomMessage("");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // PATCH 10D: Handle send with double-click protection
  const handleSend = async () => {
    if (clickGuard || sendNotification.isPending) return;
    setClickGuard(true);
    try {
      await sendNotification.mutateAsync();
    } finally {
      setTimeout(() => setClickGuard(false), 2000); // 2 sec cooldown
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Отправить уведомление
          </DialogTitle>
          <DialogDescription>
            Отправка сообщения в Telegram пользователю {userName || userEmail}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <Label>Тип сообщения</Label>
            <RadioGroup value={messageType} onValueChange={setMessageType}>
              {notificationTypes.map((type) => {
                // PATCH 10D: Disable access_revoked if user has active subscription
                const isRevokeDisabled = type.value === 'access_revoked' && hasActiveSubscription;
                
                return (
                  <div key={type.value} className="flex items-center space-x-2">
                    <RadioGroupItem 
                      value={type.value} 
                      id={type.value} 
                      disabled={isRevokeDisabled}
                    />
                    <Label 
                      htmlFor={type.value} 
                      className={cn(
                        "font-normal cursor-pointer",
                        isRevokeDisabled && "text-muted-foreground cursor-not-allowed"
                      )}
                    >
                      {type.label}
                      {isRevokeDisabled && (
                        <span className="ml-2 text-xs text-amber-600 inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          подписка до {accessEndDate}
                        </span>
                      )}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          {messageType === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="custom-message">Текст сообщения</Label>
              <Textarea
                id="custom-message"
                placeholder="Введите текст сообщения..."
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={4}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleSend}
            disabled={sendNotification.isPending || clickGuard || (messageType === "custom" && !customMessage.trim())}
          >
            {sendNotification.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Отправить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
