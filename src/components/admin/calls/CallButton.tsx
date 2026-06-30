// ============================================================================
// CallButton — кнопка «Позвонить» (VOCHI click-to-call) для карточки
// контакта/сделки. Серверная инициация через edge-функцию vochi-call-initiate.
// Все проверки прав/конфигурации интеграции — на сервере; кнопка дизаблится
// только пока активен запрос или предыдущий звонок ещё в статусе initiating.
// ============================================================================

import { useState } from "react";
import { Phone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  sip_extension_missing:
    "У вас не задан внутренний SIP-номер VOCHI — попросите администратора заполнить его в профиле",
  integration_not_configured: "VOCHI ещё не подключён в админке",
  integration_disabled: "Интеграция VOCHI отключена",
  client_id_missing: "В настройках VOCHI не задан clientId",
  not_staff: "У вас нет прав на исходящие звонки",
  invalid_phone: "Некорректный номер телефона",
  vochi_api_error: "VOCHI вернул ошибку при инициации звонка",
  vochi_fetch_failed: "Не удалось связаться с VOCHI",
};

export function CallButton({
  phone,
  contactId,
  dealId,
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const disabled = !phone || busy;

  const handleClick = async () => {
    if (!phone) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "vochi-call-initiate",
        {
          body: { phone, contact_id: contactId, deal_id: dealId },
        },
      );
      if (error) {
        // Edge function вернула non-2xx; supabase-js обнуляет data, а тело
        // ответа лежит в error.context (Response). Читаем настоящий код.
        let code: string | undefined = (data as any)?.error;
        let detail: string | undefined;
        const ctx: any = (error as any)?.context;
        if (!code && ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            code = parsed?.error;
            detail = parsed?.detail ?? parsed?.http_status;
          } catch {
            try {
              const txt = await ctx.text();
              detail = txt?.slice(0, 200);
            } catch {}
          }
        }
        const label = code ? ERROR_LABEL[code] : undefined;
        toast.error(
          label ?? (code ? `Ошибка: ${code}` : "Не удалось связаться с VOCHI"),
          detail ? { description: String(detail) } : undefined,
        );
        return;
      }
      if ((data as any)?.idempotent) {
        toast.info("Звонок уже инициирован — ждём, пока поднимет трубку");
      } else {
        toast.success("Звоним вам — поднимите трубку, чтобы соединиться");
      }
      // Мгновенно обновим список звонков (не ждём realtime).
      queryClient.invalidateQueries({ queryKey: ["calls-history", { contactId, dealId }] });
      queryClient.invalidateQueries({ queryKey: ["calls-history"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось инициировать звонок");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={disabled}
      onClick={handleClick}
      className={className}
      title={!phone ? "Не указан телефон" : "Позвонить через VOCHI"}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
      ) : (
        <Phone className="h-3.5 w-3.5 mr-1" />
      )}
      Позвонить
    </Button>
  );
}
