// ============================================================================
// SmsButton — кнопка «SMS» рядом с «Позвонить» для карточки контакта/сделки.
// Открывает диалог с textarea, шлёт через edge-функцию websms-send.
// Все проверки прав/конфигурации интеграции — на сервере.
// ============================================================================

import { useState } from "react";
import { MessageSquare, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  phone: string | null | undefined;
  contactId?: string;
  dealId?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary";
  className?: string;
}

const ERROR_LABEL: Record<string, string> = {
  smsby_credentials_missing:
    "В админке не настроен API-токен SMS.by",
  websms_credentials_missing:
    "В админке не настроен API-токен SMS.by",
  integration_not_configured: "SMS.by ещё не подключён в админке",
  integration_disabled: "Интеграция SMS.by отключена",
  not_staff: "У вас нет прав на отправку SMS",
  invalid_phone: "Некорректный номер телефона",
  empty_text: "Введите текст сообщения",
  text_too_long: "Слишком длинный текст (максимум 1000 символов)",
  smsby_api_error: "SMS.by вернул ошибку",
  websms_api_error: "SMS.by вернул ошибку",
  smsby_fetch_failed: "Не удалось связаться с SMS.by",
  websms_fetch_failed: "Не удалось связаться с SMS.by",
};

const SMS_SEGMENT = 70; // Cyrillic UCS-2 — 70 символов в одном сегменте

export function SmsButton({
  phone,
  contactId,
  dealId,
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const disabled = !phone;
  const segments = text ? Math.max(1, Math.ceil(text.length / SMS_SEGMENT)) : 0;

  const handleSend = async () => {
    if (!phone) return;
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Введите текст сообщения");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("websms-send", {
        body: { phone, text: trimmed, contact_id: contactId, deal_id: dealId },
      });
      if (error) {
        let code: string | undefined = (data as any)?.error;
        let detail: string | undefined;
        const ctx: any = (error as any)?.context;
        if (!code && ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            code = parsed?.error;
            detail = parsed?.detail ?? parsed?.body_snippet ?? parsed?.http_status;
          } catch {
            try {
              detail = (await ctx.text())?.slice(0, 200);
            } catch {}
          }
        }
        const label = code ? ERROR_LABEL[code] : undefined;
        toast.error(
          label ?? (code ? `Ошибка: ${code}` : "Не удалось отправить SMS"),
          detail ? { description: String(detail) } : undefined,
        );
        return;
      }
      toast.success("SMS отправлено");
      setText("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["sms-history", { contactId, dealId }] });
      queryClient.invalidateQueries({ queryKey: ["sms-history"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось отправить SMS");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={className}
        title={!phone ? "Не указан телефон" : "Отправить SMS"}
      >
        <MessageSquare className="h-3.5 w-3.5 mr-1" />
        SMS
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Отправить SMS</DialogTitle>
            <DialogDescription>
              На номер <span className="font-medium">{phone}</span> через websms.by
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sms-text" className="text-xs">
              Текст сообщения
            </Label>
            <Textarea
              id="sms-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Введите текст..."
              rows={5}
              maxLength={1000}
              autoFocus
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{text.length} / 1000</span>
              <span>{segments > 0 ? `${segments} SMS-сегмент(ов)` : ""}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button onClick={handleSend} disabled={busy || !text.trim()}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-2" />
              )}
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
