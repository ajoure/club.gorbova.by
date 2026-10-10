import { describe, it, expect } from 'vitest';
import { questionnaireThanksSlug, renderQuestionnaireBroadcast, preserveQuestionnaireUrls } from '../../supabase/functions/_shared/questionnaireBroadcast';
import { instrumentTelegramText } from '../../supabase/functions/_shared/broadcastAnalytics';
import { readSiteFormEventCondition } from './siteFormEventCondition';
const source = { id: 'source', workspace_id: 'workspace', status: 'published', blocks: [{ id:'form', type:'form', content:{ auth_mode:true, questionnaire_first:true, redirectUrl:'/thanks' } }] };
const bonus = { source_page_id:'source', source_block_id:'form', channel_url:'https://t.me/+join_abc-def', personal_chat_url:'https://t.me/m/message_abc-def' };
const thanks = { id:'thanks', workspace_id:'workspace', status:'published', slug:'thanks', blocks:[{ type:'questionnaire_bonuses', content:bonus }] };
const message='Спасибо! 🎁 {{questionnaire.channel_url}} 💬 {{questionnaire.personal_chat_url}}';
const origin='https://example.test';
describe('уведомление анкеты использует управляемые ссылки',()=>{
  it('reads both exact URLs and picks up administrator changes without code constants',()=>{
    const result=renderQuestionnaireBroadcast(message,source,'form',thanks,origin);
    expect(result.message).toContain(`[Telegram-канал](${bonus.channel_url})`);
    expect(result.message).toContain(`[Переписка с Катериной](${bonus.personal_chat_url})`);
    const changed={...thanks,blocks:[{type:'questionnaire_bonuses',content:{...bonus,channel_url:'https://t.me/+new_invite'}}]};
    expect(renderQuestionnaireBroadcast(message,source,'form',changed,origin).message).toContain('https://t.me/+new_invite');
  });
  it('fails closed on wrong source, unpublished pages, ambiguous bonuses, external redirect and invalid links',()=>{
    for(const invalid of [{...thanks,status:'draft'},{...thanks,workspace_id:'other'},{...thanks,blocks:[...thanks.blocks,...thanks.blocks]},
      {...thanks,blocks:[{type:'questionnaire_bonuses',content:{...bonus,source_block_id:'other'}}]},
      {...thanks,blocks:[{type:'questionnaire_bonuses',content:{...bonus,channel_url:'https://evil.test/channel'}}]}])
      expect(()=>renderQuestionnaireBroadcast(message,source,'form',invalid,origin)).toThrow();
    expect(()=>questionnaireThanksSlug({...source,blocks:[{...source.blocks[0],content:{...source.blocks[0].content,redirectUrl:'https://evil.test/thanks'}}]},'form',origin)).toThrow();
    expect(()=>renderQuestionnaireBroadcast(message+' {{questionnaire.unknown}}',source,'form',thanks,origin)).toThrow('questionnaire_message_unresolved');
  });
  it('keeps Telegram invite and Business URL byte-exact while other campaigns still track links',()=>{
    (globalThis as typeof globalThis & { Deno: unknown }).Deno={env:{get:()=>undefined}};
    const result=renderQuestionnaireBroadcast(message,source,'form',thanks,origin);
    const tracking={clickTokens:new Map([[bonus.channel_url,'channel-token'],[bonus.personal_chat_url,'personal-token'],['https://example.test/other','other-token']])};
    const protectedTracking=preserveQuestionnaireUrls(tracking,result.protectedUrls);
    const rendered=instrumentTelegramText(result.message+' https://example.test/other',protectedTracking);
    expect(rendered).toContain(bonus.channel_url);expect(rendered).toContain(bonus.personal_chat_url);
    expect(rendered).toContain('/broadcast-track/c/other-token');
    expect(tracking.clickTokens.size).toBe(3);
    expect(instrumentTelegramText(bonus.channel_url,tracking)).toContain('/broadcast-track/c/channel-token');
  });
  it('preserves the activation cutoff through the existing rule editor',()=>{
    const condition={page_id:'00000000-0000-4000-8000-000000000001',block_id:'00000000-0000-4000-8000-000000000002',event:'submitted',submissions_from:'2026-10-10T15:00:00Z'};
    expect(readSiteFormEventCondition(condition)).toEqual(condition);
    expect(readSiteFormEventCondition({...condition,submissions_from:'bad'})).toBeNull();
  });
});
