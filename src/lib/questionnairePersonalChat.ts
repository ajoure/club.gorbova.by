/** The business chat link has its draft message configured in Telegram. */
export function questionnairePersonalChatUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https:\/\/t\.me\/m\/[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}
