import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Loader2, Send } from "lucide-react";

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
      if (!data.success) throw new Error(data.error || "Ошибка отправки");
      return data;
    },
    onSuccess: () => {
      toast.success("Уведомление отправлено");
      onOpenChange(false);
      setMessageType("welcome");
      setCustomMessage("");
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

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
              {notificationTypes.map((type) => (
                <div key={type.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={type.value} id={type.value} />
                  <Label htmlFor={type.value} className="font-normal cursor-pointer">
                    {type.label}
                  </Label>
                </div>
              ))}
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
            onClick={() => sendNotification.mutate()}
            disabled={sendNotification.isPending || (messageType === "custom" && !customMessage.trim())}
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
