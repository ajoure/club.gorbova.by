import { prepareQuestionnaireBonusInvite, type BonusBackend } from '../site-form-submit/questionnaire-bonus-invite.ts';

/** Called only for an approved, eligible, single-recipient Telegram delivery. */
export async function resolveQuestionnaireTelegramButton(
  admin: BonusBackend, metadata: Record<string, unknown> | null, userId: string,
  existingUrl: string | null, prepare = prepareQuestionnaireBonusInvite,
): Promise<string | null> {
  const condition = metadata?.site_form_condition;
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return existingUrl;
  const c = condition as Record<string, unknown>;
  if (c.personal_bonus_invite !== true) return existingUrl;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (c.event !== 'submitted' || typeof c.page_id !== 'string' || !uuid.test(c.page_id)
    || typeof c.block_id !== 'string' || !uuid.test(c.block_id)) throw new Error('bonus_invite_condition_invalid');
  const result = await prepare(admin,c.page_id,c.block_id,userId);
  if (result.status !== 200 || result.body.success !== true || typeof result.body.invite_link !== 'string'
    || !/^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(result.body.invite_link)) {
    throw new Error('bonus_invite_unavailable');
  }
  return result.body.invite_link;
}
