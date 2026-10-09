import { describe, expect, it, vi } from 'vitest';
import { handleQuestionnaireBonusJoin } from '../../supabase/functions/telegram-webhook/questionnaire-bonus';

describe('questionnaire bonus join', () => {
  it('leaves commercial channels untouched and approves only permanent bonus eligibility', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    expect(await handleQuestionnaireBonusJoin({ configured: false, eligible: false }, -100, 123, request)).toEqual({ handled: false, success: true });
    expect(request).not.toHaveBeenCalled();
    expect(await handleQuestionnaireBonusJoin({ configured: true, eligible: true }, -100, 123, request)).toEqual({ handled: true, success: true, approved: true });
    expect(request).toHaveBeenCalledWith('approveChatJoinRequest', { chat_id: -100, user_id: 123 });
  });
  it('declines an unverified bonus join without payments, messages or bans', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    expect(await handleQuestionnaireBonusJoin({ configured: true, eligible: false }, -100, 123, request)).toEqual({ handled: true, success: true, approved: false });
    expect(request.mock.calls).toEqual([['declineChatJoinRequest', { chat_id: -100, user_id: 123 }]]);
  });
  it('requires actual membership proof on replay and retries unresolved API errors', async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, result: { status: 'member' } });
    expect(await handleQuestionnaireBonusJoin({ configured: true, eligible: true }, -100, 123, request)).toEqual({ handled: true, success: true, approved: true, alreadyMember: true });
    request.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, result: { status: 'left' } });
    expect(await handleQuestionnaireBonusJoin({ configured: true, eligible: true }, -100, 123, request)).toEqual({ handled: true, success: false });
  });
});
