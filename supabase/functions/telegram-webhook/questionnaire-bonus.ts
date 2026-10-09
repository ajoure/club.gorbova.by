export type BonusJoinContext = { configured: boolean; eligible: boolean; user_id?: string | null };
type TelegramResult = { ok?: boolean; result?: { status?: string; is_member?: boolean } | boolean };
type TelegramCall = (method: string, params: Record<string, unknown>) => Promise<TelegramResult>;

// Free questionnaire membership never writes commercial access or club members,
// sends payment messages, or kicks an existing participant.
export async function handleQuestionnaireBonusJoin(
  context: BonusJoinContext,
  chatId: number,
  telegramUserId: number,
  request: TelegramCall,
): Promise<{ handled: boolean; success: boolean; approved?: boolean; alreadyMember?: boolean }> {
  if (!context.configured) return { handled: false, success: true };
  const params = { chat_id: chatId, user_id: telegramUserId };
  const result = await request(context.eligible ? 'approveChatJoinRequest' : 'declineChatJoinRequest', params);
  if (result.ok === true) return { handled: true, success: true, approved: context.eligible };
  // Telegram can replay an update after an approval. Prove current membership
  // rather than treating an arbitrary API error as successful approval.
  const current = await request('getChatMember', params);
  const member = current.ok === true && typeof current.result === 'object' && current.result !== null
    && (['creator','administrator','member'].includes(current.result.status ?? '')
      || (current.result.status === 'restricted' && current.result.is_member === true));
  return member
    ? { handled: true, success: true, approved: context.eligible, alreadyMember: true }
    : { handled: true, success: false };
}
