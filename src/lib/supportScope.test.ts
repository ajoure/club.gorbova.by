import { describe, expect, it } from 'vitest';
import { supportActionAllowed, supportActionMessageIds, supportMessageMatches } from '../../supabase/functions/telegram-admin-chat/supportScope';
const bot = 'service';
const row = { id:'incoming', user_id:'client', bot_id:bot, transport:'bot', business_account_id:null, business_connection_id:null };
describe('support isolation before external effects', () => {
  it('rejects Business metadata even when mislabeled as a bot', () => {
    expect(supportMessageMatches(row, bot, 'client')).toBe(true);
    for (const patch of [{transport:'business'}, {business_account_id:'personal'}, {business_connection_id:'private'}, {bot_id:'other'}, {user_id:'other'}]) {
      expect(supportMessageMatches({...row,...patch}, bot,'client')).toBe(false);
    }
  });
  it('requires explicit bot and recipient; rejects fallback and unsupported actions', () => {
    const action = {action:'send_message', support_bot_id:bot, support_observed_incoming_id:'incoming', support_request_id:'request', bot_id:bot, sender_type:'bot', user_id:'client'};
    expect(supportActionAllowed(action)).toBe(true);
    for (const patch of [{support_request_id:undefined}, {support_observed_incoming_id:undefined}, {bot_id:undefined}, {sender_type:'business'}, {business_account_id:'personal'}, {user_id:undefined}, {action:'process_media_jobs'}, {action:'bridge_ticket_message'}, {action:'get_messages'}]) {
      expect(supportActionAllowed({...action,...patch})).toBe(false);
    }
  });
  it('requires a bounded explicit set for media/reactions', () => {
    expect(supportActionAllowed({action:'get_media_urls',support_bot_id:bot,message_ids:[]})).toBe(false);
    expect(supportActionAllowed({action:'get_media_urls',support_bot_id:bot,message_ids:['one']})).toBe(true);
    expect(supportActionMessageIds({action:'get_media_urls',message_ids:['one','one']})).toEqual(['one']);
    expect(supportActionAllowed({action:'sync_telegram_reaction',support_bot_id:bot,telegram_message_db_id:'one'})).toBe(true);
  });
});
