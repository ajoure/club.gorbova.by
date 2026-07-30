export type TelegramSenderSelection =
  | { type: "bot"; botId: string; businessAccountId: null }
  | { type: "business"; botId: null; businessAccountId: string }
  | null;

export interface TelegramSenderMessage {
  direction: "incoming" | "outgoing";
  created_at: string;
  transport?: "bot" | "business" | null;
  bot_id?: string | null;
  business_account_id?: string | null;
}

export interface TelegramSenderBot {
  id: string;
  is_primary?: boolean | null;
}

export interface TelegramBusinessSender {
  id: string;
  is_enabled?: boolean | null;
  can_reply?: boolean | null;
}

/**
 * Sender routing for the Contact Center:
 * - an existing dialog follows the transport of its latest incoming message;
 * - a new dialog (or an unavailable historical sender) uses the primary
 *   support bot;
 * - a personal Telegram Business account is never selected merely because it
 *   appears somewhere in the dialog history.
 */
export function selectDefaultTelegramSender({
  messages,
  activeBots,
  businessAccount,
}: {
  messages: TelegramSenderMessage[];
  activeBots: TelegramSenderBot[];
  businessAccount?: TelegramBusinessSender | null;
}): TelegramSenderSelection {
  const latestIncoming = messages
    .filter((message) => message.direction === "incoming")
    .reduce<TelegramSenderMessage | null>((latest, message) => {
      if (!latest) return message;
      return new Date(message.created_at).getTime() > new Date(latest.created_at).getTime()
        ? message
        : latest;
    }, null);

  if (
    latestIncoming?.transport === "business" &&
    latestIncoming.business_account_id &&
    businessAccount?.id === latestIncoming.business_account_id &&
    businessAccount.is_enabled &&
    businessAccount.can_reply
  ) {
    return {
      type: "business",
      botId: null,
      businessAccountId: businessAccount.id,
    };
  }

  if (
    latestIncoming?.transport !== "business" &&
    latestIncoming?.bot_id &&
    activeBots.some((bot) => bot.id === latestIncoming.bot_id)
  ) {
    return {
      type: "bot",
      botId: latestIncoming.bot_id,
      businessAccountId: null,
    };
  }

  const primaryBot = activeBots.find((bot) => bot.is_primary) ?? activeBots[0];
  return primaryBot
    ? { type: "bot", botId: primaryBot.id, businessAccountId: null }
    : null;
}
