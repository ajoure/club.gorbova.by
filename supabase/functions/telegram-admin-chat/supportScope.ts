// Only metadata is read until every requested message is proven to belong to
// one explicitly enabled service bot. Business IDs override transport labels.
export interface SupportAction {
  action: string;
  support_bot_id?: string;
  support_request_id?: string;
  support_observed_incoming_id?: string | null;
  bot_id?: string;
  sender_type?: string;
  business_account_id?: string;
  user_id?: string;
  message_ids?: string[];
  db_message_id?: string;
  telegram_message_db_id?: string;
}
export interface SupportMessageMetadata {
  id: string;
  bot_id: string | null;
  transport: string | null;
  business_account_id: string | null;
  business_connection_id: string | null;
  user_id: string | null;
}
export function supportMessageMatches(row: SupportMessageMetadata, botId: string, userId?: string): boolean {
  return row.bot_id === botId && row.transport === 'bot'
    && row.business_account_id === null && row.business_connection_id === null
    && (!userId || row.user_id === userId);
}
export function supportActionMessageIds(payload: SupportAction): string[] {
  if (payload.action === 'get_media_urls') return [...new Set(payload.message_ids || [])];
  if (payload.action === 'sync_telegram_reaction') return payload.telegram_message_db_id ? [payload.telegram_message_db_id] : [];
  return [];
}
export function supportActionAllowed(payload: SupportAction): boolean {
  if (!payload.support_bot_id || payload.business_account_id || payload.sender_type === 'business') return false;
  if (payload.action === 'send_message') {
    return payload.bot_id === payload.support_bot_id && payload.sender_type === 'bot' && !!payload.user_id && !!payload.support_observed_incoming_id && !!payload.support_request_id;
  }
  return ['get_media_urls', 'sync_telegram_reaction'].includes(payload.action)
    && supportActionMessageIds(payload).length > 0 && supportActionMessageIds(payload).length <= 200;
}
export async function assertSupportAction(client: any, payload: SupportAction, actorId: string): Promise<void> {
  const botId = payload.support_bot_id;
  if (!botId) return; // Legacy operator workspace is unchanged.
  if (!supportActionAllowed(payload)) throw new Error('support_action_not_allowed');
  const { data: bot, error: botError } = await client.from('telegram_bots')
    .select('id').eq('id', botId).eq('status', 'active').eq('support_enabled', true).maybeSingle();
  if (botError || !bot) throw new Error('support_channel_not_allowed');
  let scopedUserId = payload.user_id;
  const ids = supportActionMessageIds(payload);
  if (ids.length) {
    const { data: rows, error } = await client.from('telegram_messages')
      .select('id,bot_id,transport,business_account_id,business_connection_id,user_id').in('id', ids);
    if (error || rows?.length !== ids.length || !rows.every((r: SupportMessageMetadata) => supportMessageMatches(r, botId, payload.user_id))) {
      throw new Error('support_message_scope_mismatch');
    }
    if (payload.action === 'sync_telegram_reaction') scopedUserId = rows[0].user_id;
  }
  if (payload.action === 'send_message') {
    const { data: incoming, error } = await client.from('telegram_messages')
      .select('id,telegram_user_id').eq('user_id', payload.user_id).eq('bot_id', botId)
      .eq('transport', 'bot').is('business_account_id', null).is('business_connection_id', null)
      .eq('direction', 'incoming').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (incoming?.id !== payload.support_observed_incoming_id) throw new Error('support_new_incoming_refresh_required');
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('telegram_user_id').eq('user_id', payload.user_id).maybeSingle();
    if (error || profileError || !incoming || !profile?.telegram_user_id || String(profile.telegram_user_id) !== String(incoming.telegram_user_id)) {
      throw new Error('support_recipient_not_verified');
    }
  }
  if (payload.action === 'send_message' || payload.action === 'sync_telegram_reaction') {
    if (!scopedUserId) throw new Error('support_recipient_not_verified');
    const { data: assignments, error: assignmentError } = await client.from('contact_center_message_assignments')
      .select('assignee_user_id,telegram_messages!contact_center_message_assignments_source_message_id_fkey!inner(user_id,bot_id,transport,business_account_id,business_connection_id)')
      .is('resolved_at', null).eq('telegram_messages.user_id', scopedUserId).eq('telegram_messages.bot_id', botId)
      .eq('telegram_messages.transport', 'bot').is('telegram_messages.business_account_id', null).is('telegram_messages.business_connection_id', null);
    if (assignmentError || assignments?.some((r: { assignee_user_id: string }) => r.assignee_user_id !== actorId)) {
      throw new Error('support_assigned_to_another_employee');
    }
  }
}
