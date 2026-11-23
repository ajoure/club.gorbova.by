import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFullBroadcastAudience } from './broadcastConfirmation';
import { smsAudienceCount, smsBroadcastRequestId, smsBroadcastCampaignId, smsTextFromMetadata } from './smsBroadcast';
afterEach(() => vi.unstubAllGlobals());
describe('SMS channel isolation and durable request identity', () => {
  it('never substitutes email/TG totals or a missing result for an SMS count', () => {
    expect(smsAudienceCount({ sms_count: 0 })).toBe(0);
    expect(smsAudienceCount({ sms_count: 12 })).toBe(12);
    for (const invalid of [null, {}, { email_count: 80 }, { sms_count: '5' }, { sms_count: -1 }, { sms_count: NaN }]) expect(() => smsAudienceCount(invalid)).toThrow();
  });
  it('ignores Telegram bot selection for the full SMS audience guard', () => {
    expect(isFullBroadcastAudience({ bot_ids: ['bot'] }, 'sms')).toBe(true);
    expect(isFullBroadcastAudience({ include: ['profile'] }, 'sms')).toBe(false);
    expect(isFullBroadcastAudience({ education: { lesson_id: 'lesson' } }, 'sms')).toBe(false);
  });
  it('round trips plain SMS independently of other template metadata', () => {
    const metadata = { site_form_condition: { event: 'submitted' }, sms_text: 'Здравствуйте!\nhttps://example.com' };
    expect(smsTextFromMetadata(JSON.parse(JSON.stringify(metadata)))).toBe(metadata.sms_text);
    expect(smsTextFromMetadata({ email_body_html: '<p>Не SMS</p>' })).toBe('');
    expect(smsTextFromMetadata({ sms_text: 9 })).toBe('');
  });
  it('reuses the same persisted identity after an unknown response/reload and separates actors/content', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const body = { text: 'Учебное сообщение', filters: { include: ['profile'] } };
    const first = await smsBroadcastRequestId('actor-a', body, storage);
    expect(await smsBroadcastRequestId('actor-a', structuredClone(body), storage)).toBe(first);
    expect(await smsBroadcastRequestId('actor-b', body, storage)).not.toBe(first);
    expect(await smsBroadcastRequestId('actor-a', { ...body, text: 'Другое сообщение' }, storage)).not.toBe(first);
    expect([...data.keys()].some(key => key.includes(body.text))).toBe(false);
  });
  it('keeps the original campaign metadata when a request is reconciled', () => {
    const map = new Map<string, string>(); const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
    expect(smsBroadcastCampaignId('request', 'original', storage)).toBe('original');
    expect(smsBroadcastCampaignId('request', 'new-click', storage)).toBe('original');
  });
  it('fails before dispatch if durable request storage cannot be written', async () => {
    vi.stubGlobal('crypto', webcrypto);
    await expect(smsBroadcastRequestId('actor', {}, { getItem: () => null, setItem: () => { throw Error('storage unavailable'); } })).rejects.toThrow('storage unavailable');
  });
});
