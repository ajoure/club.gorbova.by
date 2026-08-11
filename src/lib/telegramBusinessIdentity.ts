export interface TelegramBusinessIdentity {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}

interface TelegramMessageIdentityInput {
  direction: "incoming" | "outgoing";
  transport?: "bot" | "business" | null;
  source?: string | null;
  messageOrigin?: string | null;
  businessAccount?: TelegramBusinessIdentity | null;
  botName?: string | null;
  botUsername?: string | null;
}

export function getTelegramBusinessAccountName(
  account?: TelegramBusinessIdentity | null,
): string | null {
  if (!account) return null;
  const fullName = [account.first_name, account.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  if (fullName) return fullName;
  const username = account.username?.trim().replace(/^@+/, "");
  return username ? `@${username}` : null;
}

export function getTelegramPersonalChannelLabel(
  account?: TelegramBusinessIdentity | null,
): string {
  const name = getTelegramBusinessAccountName(account);
  return name ? `${name} · личный Telegram` : "Личный Telegram";
}

export function getTelegramMessageIdentityLabel({
  direction,
  transport,
  source,
  messageOrigin,
  businessAccount,
  botName,
  botUsername,
}: TelegramMessageIdentityInput): string | null {
  const isBusiness = transport === "business" || source === "telegram_business";
  if (isBusiness) {
    const name = getTelegramBusinessAccountName(businessAccount);
    if (direction === "incoming") {
      return getTelegramPersonalChannelLabel(businessAccount);
    }
    if (messageOrigin === "owner_manual") {
      return name ? `${name} · вручную` : "Личный Telegram · вручную";
    }
    return name ? `${name} · CRM` : "Личный Telegram · CRM";
  }

  const normalizedBotName = botName?.trim();
  if (normalizedBotName) return normalizedBotName;
  const normalizedUsername = botUsername?.trim().replace(/^@+/, "");
  return normalizedUsername ? `@${normalizedUsername}` : null;
}
