import { supabase } from "@/integrations/supabase/client";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";

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
  const userId = input.userId.trim();
  const message = input.message.trim();
  let paymentUrl: URL;

  if (!userId) throw new Error("У выбранной сделки нет владельца для отправки");
  if (!message) throw new Error("Текст сообщения для Telegram пуст");

  try {
    paymentUrl = new URL(input.paymentUrl);
  } catch {
    throw new Error("Ссылка на оплату имеет неверный формат");
  }
  if (!["https:", "http:"].includes(paymentUrl.protocol)) {
    throw new Error("Ссылка на оплату имеет недопустимый протокол");
  }

  const urlDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(paymentUrl.toString()),
  );
  const paymentLinkFingerprint = Array.from(new Uint8Array(urlDigest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const { data, error } = await supabase.functions.invoke(
    "telegram-send-notification",
    {
      body: {
        user_id: userId,
        message_type: "custom",
        custom_message: message,
        idempotency_key: `payment-link:${paymentLinkFingerprint}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Ссылка на оплату", url: paymentUrl.toString() }],
          ],
        },
      },
    },
  );

  if (error) {
    const normalized = await normalizeEdgeFunctionErrorAsync(error, data);
    const status = Number((error as { context?: { status?: unknown } })?.context?.status);
    throw new Error(Number.isFinite(status) ? `${normalized} (HTTP ${status})` : normalized);
  }
  if (!data?.success) throw new Error(data?.error || "Ошибка отправки");
  return data;
}
