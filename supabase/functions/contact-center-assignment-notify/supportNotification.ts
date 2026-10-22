export function supportNotificationScope(message: any, botId: string): boolean {
  return !!message?.user_id && message.bot_id === botId && message.transport === 'bot'
    && message.business_account_id === null && message.business_connection_id === null;
}
export function supportNotificationLink(userId: string, botId: string): string {
  const params = new URLSearchParams({tab:'inbox',support_mode:'1',bot:botId,chat:userId});
  return `https://gorbova.by/admin/communication?${params}`;
}
