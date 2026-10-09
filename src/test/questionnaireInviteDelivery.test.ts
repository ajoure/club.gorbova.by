import { describe,expect,it,vi } from 'vitest';
import { resolveQuestionnaireTelegramButton } from '../../supabase/functions/process-scheduled-broadcasts/site-questionnaire-invitation';
import { readSiteFormEventCondition } from '../lib/siteFormEventCondition';
import type { BonusBackend } from '../../supabase/functions/site-form-submit/questionnaire-bonus-invite';
const page='00000000-0000-4000-8000-000000000003';
const block='00000000-0000-4000-8000-000000000005';
const admin={} as BonusBackend;
const metadata={site_form_condition:{page_id:page,block_id:block,event:'submitted',personal_bonus_invite:true}};
describe('personal questionnaire Telegram notification',()=>{
  it('keeps ordinary template destinations and never creates invitations without opt-in',async()=>{
    const prepare=vi.fn();
    expect(await resolveQuestionnaireTelegramButton(admin,null,'owner','https://gorbova.by',prepare)).toBe('https://gorbova.by');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('resolves the exact delivery owner and replaces a general invitation only after successful journal creation',async()=>{
    const prepare=vi.fn().mockResolvedValue({status:200,body:{success:true,invite_link:'https://t.me/+owner-fixture'}});
    expect(await resolveQuestionnaireTelegramButton(admin,metadata,'owner','https://t.me/+general-fixture',prepare)).toBe('https://t.me/+owner-fixture');
    expect(prepare).toHaveBeenCalledWith(admin,page,block,'owner');
  });
  it('never falls back to the general invitation when ownership or provider verification fails',async()=>{
    const prepare=vi.fn().mockResolvedValue({status:403,body:{error:'ineligible'}});
    await expect(resolveQuestionnaireTelegramButton(admin,metadata,'owner','https://t.me/+general-fixture',prepare)).rejects.toThrow('bonus_invite_unavailable');
    prepare.mockResolvedValue({status:200,body:{success:true,invite_link:'https://wrong.example'}});
    await expect(resolveQuestionnaireTelegramButton(admin,metadata,'owner',null,prepare)).rejects.toThrow('bonus_invite_unavailable');
  });
  it('does not create invitations for an incomplete questionnaire reminder',async()=>{
    const prepare=vi.fn();
    await expect(resolveQuestionnaireTelegramButton(admin,{site_form_condition:{...metadata.site_form_condition,event:'email_confirmed_incomplete'}},'owner',null,prepare)).rejects.toThrow('bonus_invite_condition_invalid');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('preserves the invitation setting through editor normalization and rejects non-boolean values',()=>{
    expect(readSiteFormEventCondition(metadata.site_form_condition)).toEqual(metadata.site_form_condition);
    expect(readSiteFormEventCondition({...metadata.site_form_condition,personal_bonus_invite:'true'})).toBeNull();
  });
});
