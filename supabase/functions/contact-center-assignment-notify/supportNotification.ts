export function supportNotificationScope(message: any, botId: string): boolean {
  return !!message?.user_id && message.bot_id === botId && message.transport === 'bot'
    && message.business_account_id === null && message.business_connection_id === null;
}
export function supportNotificationLink(userId: string, botId: string): string {
  const params = new URLSearchParams({tab:'inbox',support_mode:'1',bot:botId,chat:userId});
  return `https://gorbova.by/admin/communication?${params}`;
}
// The server configuration, never an optional browser hint, chooses routing.
export function deriveSupportNotificationBot(source: any, sourceBot: any, requested?: string): string | null {
  if (source?.transport === 'bot') {
    // An unavailable or unapproved bot remains a bot source. Never downgrade it
    // into the legacy Business/primary-bot path when configuration is missing.
    if (!sourceBot || sourceBot.status !== 'active' || sourceBot.support_enabled !== true
      || !supportNotificationScope(source,sourceBot.id)) throw new Error('support_notification_channel_unavailable');
    if (requested && requested !== sourceBot.id) throw new Error('support_notification_scope_mismatch');
    return sourceBot.id;
  }
  if (requested || source?.transport !== 'business') throw new Error('support_notification_scope_mismatch');
  return null; // Existing explicit Business operator path, never support.
}
