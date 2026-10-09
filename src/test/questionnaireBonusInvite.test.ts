import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareQuestionnaireBonusInvite } from '../../supabase/functions/site-form-submit/questionnaire-bonus-invite';

function fixture(route: Record<string, unknown>) {
  const rpc = vi.fn().mockResolvedValueOnce({ data: route, error: null }).mockResolvedValue({ data: true, error: null });
  const single = vi.fn().mockResolvedValue({ data: { bot_token_encrypted: 'fixture-only-token' }, error: null });
  const chain = { select: vi.fn(), eq: vi.fn(), single };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  const admin = { rpc, from: vi.fn().mockReturnValue(chain) } as unknown as Parameters<typeof prepareQuestionnaireBonusInvite>[0];
  return { admin, rpc };
}
describe('private questionnaire invitation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('does not call Telegram for an unverified owner or a cached invite', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    let f = fixture({ status: 'ineligible' });
    expect((await prepareQuestionnaireBonusInvite(f.admin, 'page', 'block', 'user')).status).toBe(403);
    f = fixture({ status: 'ready', invite_link: 'https://t.me/+fixture', expires_at: null });
    expect((await prepareQuestionnaireBonusInvite(f.admin, 'page', 'block', 'user')).body.success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('creates a permanent join-request link and returns it only after the owner journal is saved', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { invite_link: 'https://t.me/+fixture', creates_join_request: true } }) });
    vi.stubGlobal('fetch', fetch);
    const { admin, rpc } = fixture({ status: 'create', request_id: 'reservation', bot_id: 'bot', channel_id: -100123 });
    const result = await prepareQuestionnaireBonusInvite(admin, 'page', 'block', 'user');
    expect(result.status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ chat_id: -100123, creates_join_request: true });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('expire_date');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('member_limit');
    expect(rpc).toHaveBeenLastCalledWith('finish_site_questionnaire_bonus_invite', { p_request_id: 'reservation', p_user_id: 'user', p_invite_link: 'https://t.me/+fixture' });
  });
  it('never returns a normal invitation or a link from an unsaved reservation', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { invite_link: 'https://t.me/+fixture', creates_join_request: false } }) });
    vi.stubGlobal('fetch', fetch);
    const { admin, rpc } = fixture({ status: 'create', request_id: 'reservation', bot_id: 'bot', channel_id: -100123 });
    expect((await prepareQuestionnaireBonusInvite(admin, 'page', 'block', 'user')).status).toBe(503);
    expect(rpc).toHaveBeenLastCalledWith('finish_site_questionnaire_bonus_invite', { p_request_id: 'reservation', p_user_id: 'user' });
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { invite_link: 'https://t.me/+fixture', creates_join_request: true } }) });
    const next=fixture({ status:'create',request_id:'new',bot_id:'bot',channel_id:-100123 });
    next.rpc.mockResolvedValueOnce({ data:false,error:null });
    expect((await prepareQuestionnaireBonusInvite(next.admin, 'page', 'block', 'user')).status).toBe(503);
  });
  it('rejects a provider link with an expiry instead of silently giving a temporary invitation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { invite_link: 'https://t.me/+fixture', creates_join_request: true, expire_date: 1900000000 } }) }));
    const { admin, rpc }=fixture({ status:'create',request_id:'reservation',bot_id:'bot',channel_id:-100123 });
    expect((await prepareQuestionnaireBonusInvite(admin, 'page', 'block', 'user')).status).toBe(503);
    expect(rpc).toHaveBeenLastCalledWith('finish_site_questionnaire_bonus_invite', { p_request_id:'reservation',p_user_id:'user' });
  });
});
