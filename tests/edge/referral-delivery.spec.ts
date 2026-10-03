import { describe, it, expect } from 'vitest';
import { assertReferralDelivery } from '../../supabase/functions/referral-redemption-worker/delivery';
describe('referral canonical Telegram delivery', () => {
  it('accepts mirrored delivery and verified canonical replay', () => {
    expect(() => assertReferralDelivery({results:[{club_id:'club',dm_sent:true,mirrored_to_telegram_messages:true}]},'club')).not.toThrow();
    expect(() => assertReferralDelivery({results:[{club_id:'club',dm_sent:false,skipped_duplicate:true,existing_message_row_id:'message'}]},'club')).not.toThrow();
  });
  it('does not mark queued, missing, failed, or unmirrored sends complete', () => {
    for (const data of [null,{queued:true},{results:[]},{results:[{club_id:'other',dm_sent:true}]},{results:[{club_id:'club',dm_sent:false}]},{results:[{club_id:'club',dm_sent:true,mirrored_to_telegram_messages:false}]},{results:[{club_id:'club',skipped_duplicate:true}]}]) {
      expect(() => assertReferralDelivery(data,'club')).toThrow();
    }
  });
});
