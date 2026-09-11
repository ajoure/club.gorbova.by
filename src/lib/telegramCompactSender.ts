import { belongsToTelegramChannel, type ContactTelegramChannel } from "./telegramChannelScope";

type MessageScope = { transport?: string | null; bot_id?: string | null; business_account_id?: string | null };
type HistoryRow = MessageScope & { id: string; created_at: string; direction?: string; requires_reply?: boolean | null };

export function telegramMessageScopeKey(message: MessageScope, messageId: number) {
  return `${message.transport}:${message.transport === "business" ? message.business_account_id : message.bot_id}:${messageId}`;
}

/** Same global (created_at, id) ordering as the scoped RPCs, including ties. */
export function mergeTelegramChannelPages<T extends HistoryRow>(pages: T[][], limit: number, oldestFirst = false): T[] {
  const rows = [...new Map(pages.flat().map(row => [row.id, row])).values()];
  return rows.sort((a, b) => {
    const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const order = byTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return oldestFirst ? order : -order;
  }).slice(0, limit);
}

/** Ordinary open: primary support. A current unanswered inbound chooses its own sender. */
export function defaultTelegramSender(channels: ContactTelegramChannel[], messages: HistoryRow[]) {
  const latest = mergeTelegramChannelPages([messages], 1)[0];
  if (latest?.direction === "incoming" && latest.requires_reply) {
    const sender = channels.find(c => belongsToTelegramChannel(latest, c));
    if (sender) return sender;
  }
  return channels.find(c => c.is_primary) ?? channels[0];
}
