/** Message caches are isolated by the history scope, never by sender UI alone. */
export const COMBINED_TELEGRAM_SCOPE = "combined-senders-v1";

export function telegramMessageCacheKey(userId: string, scope = COMBINED_TELEGRAM_SCOPE) {
  return ["telegram-messages", userId, scope] as const;
}

export function latestObservedIncomingBoundary(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  let boundary: string | null = null;
  const subMillisecond = (value: string) =>
    (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || "").padEnd(9, "0").slice(3, 9);
  for (const message of messages) {
    if (message?.direction !== "incoming" || typeof message.created_at !== "string" ||
        !Number.isFinite(Date.parse(message.created_at))) continue;
    if (!boundary || Date.parse(message.created_at) > Date.parse(boundary) ||
        (Date.parse(message.created_at) === Date.parse(boundary) &&
          subMillisecond(message.created_at) > subMillisecond(boundary))) boundary = message.created_at;
  }
  return boundary;
}
