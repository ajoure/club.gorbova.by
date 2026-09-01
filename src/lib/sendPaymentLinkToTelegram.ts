import { supabase } from "@/integrations/supabase/client";

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendPaymentLinkToTelegram(input: {
  userId: string;
  paymentUrl: string;
  message: string;
}) {
  const { data, error } = await supabase.functions.invoke(
    "telegram-send-notification",
    {
      body: {
        user_id: input.userId,
        message_type: "custom",
        custom_message: input.message,
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Ссылка на оплату", url: input.paymentUrl }],
          ],
        },
      },
    },
  );

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || "Ошибка отправки");
  return data;
}
