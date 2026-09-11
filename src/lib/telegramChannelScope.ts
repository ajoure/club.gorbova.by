export interface TelegramChannelScope {
  transport: "bot" | "business";
  channel_ref: string;
}

export interface ContactTelegramChannel extends TelegramChannelScope {
  channel_key: string;
  label: string;
  username: string | null;
  bot_id: string;
  first_name: string | null;
  last_name: string | null;
  business_connection_id: string | null;
  is_primary: boolean;
  can_reply: boolean;
  message_count: number;
  incoming_count: number;
  unanswered_count: number;
}

export function belongsToTelegramChannel(
  message: { transport?: string | null; bot_id?: string | null; business_account_id?: string | null },
  channel: TelegramChannelScope,
): boolean {
  // A Business connection uses a bot as a bridge. Its bot_id is NOT its
  // conversation identity, even when both channels share that same bot.
  return message.transport === channel.transport && (channel.transport === "business"
    ? message.business_account_id === channel.channel_ref
    : message.bot_id === channel.channel_ref);
}

export function telegramChannelCacheKey(userId: string, channel: TelegramChannelScope) {
  return ["telegram-messages", userId, channel.transport, channel.channel_ref] as const;
}
