// ============================================================================
// CallButton — кнопка «Позвонить» (VOCHI click-to-call) для карточки
// контакта/сделки. Серверная инициация через edge-функцию vochi-call-initiate.
// Все проверки прав/конфигурации интеграции — на сервере; кнопка дизаблится
// только пока активен запрос или предыдущий звонок ещё в статусе initiating.
// ============================================================================

import { useState } from "react";
import { Phone, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
        // Edge function вернула non-2xx; в data.error код причины.
        const code = (data as any)?.error ?? "vochi_fetch_failed";
        toast.error(ERROR_LABEL[code] ?? `Ошибка: ${code}`);
        return;
      }
      if ((data as any)?.idempotent) {
        toast.info("Звонок уже инициирован — ждём, пока поднимет трубку");
      } else {
        toast.success("Звоним вам — поднимите трубку, чтобы соединиться");
      }
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
