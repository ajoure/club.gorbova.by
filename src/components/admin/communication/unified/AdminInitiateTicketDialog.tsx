import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { INBOX_DIALOGS_QK } from "@/constants/inboxQueryKeys";

/**
 * AdminInitiateTicketDialog (PATCH-CONTACT-CENTER-ADMIN-INITIATE-SUPPORT-TICKET).
 * Позволяет админу/сотруднику поддержки создать support-обращение на клиента
 * из контакт-центра. Если у клиента уже есть активный тикет — dedupe на бэкенде.
 */

const CATEGORIES: { value: string; label: string }[] = [
  { value: "general", label: "Общий вопрос" },
  { value: "payment", label: "Оплата и подписки" },
  { value: "technical", label: "Техническая проблема" },
  { value: "account", label: "Аккаунт и профиль" },
  { value: "telegram", label: "Telegram-интеграция" },
  { value: "documents", label: "Документы" },
  { value: "feature", label: "Предложение функции" },
  { value: "other", label: "Другое" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string | null;
  displayName: string;
  onCreated: (ticketId: string, createdNew: boolean) => void;
}

export function AdminInitiateTicketDialog({
  open,
  onOpenChange,
  profileId,
  displayName,
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const reset = () => {
    setCategory("general");
    setSubject("");
    setMessage("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("Не выбран профиль контакта");
      const { data, error } = await supabase.rpc(
        "admin_create_or_get_support_ticket_for_profile" as any,
        {
          p_profile_id: profileId,
          p_subject: subject.trim() || `Обращение от ${displayName}`,
          p_description: message.trim(),
          p_category: category,
          p_attachments: [],
        } as any,
      );
      if (error) throw error;
      const res = data as {
        success: boolean;
        ticket_id?: string;
        ticket_number?: string;
        created_new?: boolean;
        error?: string;
        error_code?: string;
      };
      if (!res?.success) {
        const msg =
          res?.error ||
          (res?.error_code === "forbidden"
            ? "Недостаточно прав"
            : res?.error_code === "profile_has_no_user"
              ? "Профиль не связан с пользователем — клиент не увидит тикет"
              : "Не удалось создать обращение");
        throw new Error(msg);
      }
      return res as {
        success: true;
        ticket_id: string;
        ticket_number: string;
        created_new: boolean;
      };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
      queryClient.invalidateQueries({ queryKey: ["unified-support-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["unified-ig-dialogs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["profile-channels"] });
      toast.success(
        res.created_new
          ? `Обращение #${res.ticket_number} создано, сообщение отправлено клиенту`
          : `Открыто существующее обращение #${res.ticket_number}`,
      );
      reset();
      onOpenChange(false);
      onCreated(res.ticket_id, res.created_new);
    },
    onError: (e: Error) => {
      toast.error(e.message || "Не удалось создать обращение");
    },
  });

  const canSubmit =
    !!profileId && subject.trim().length >= 3 && message.trim().length >= 1 && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Написать в техподдержку</DialogTitle>
          <DialogDescription>
            Обращение будет создано от имени поддержки для контакта{" "}
            <span className="font-medium">{displayName}</span>. Если у клиента уже есть активное
            обращение — оно будет открыто без дублирования.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>Категория</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Тема обращения</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Кратко: о чём вы пишете клиенту"
              minLength={3}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Первое сообщение</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Текст сообщения, которое клиент увидит в своём кабинете"
              className="min-h-[120px]"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Создать и отправить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
