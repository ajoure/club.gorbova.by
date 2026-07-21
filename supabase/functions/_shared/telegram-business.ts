export const TELEGRAM_BUSINESS_ALLOWED_UPDATES = [
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
] as const;

export function classifyBusinessMessage(
  message: Record<string, any>,
  businessUserId: number,
): { isOwnerMessage: boolean; remote: Record<string, any> | null; telegramUserId: number | null } {
  const isOwnerMessage = Number(message?.from?.id) === Number(businessUserId);
  const remote = (isOwnerMessage ? message?.chat : message?.from) || null;
  const candidate = Number(remote?.id || message?.chat?.id);
  return {
    isOwnerMessage,
    remote,
    telegramUserId: Number.isFinite(candidate) ? candidate : null,
  };
}
