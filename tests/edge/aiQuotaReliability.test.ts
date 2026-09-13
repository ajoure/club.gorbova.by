import { afterEach, expect, it, vi } from 'vitest';
import { countUserMessages, minskQuotaBoundaries, countChatMessagesLastMinute, sumChatContextCharsToday } from '../../supabase/functions/_shared/ai-access';

afterEach(() => vi.useRealTimers());
it.each([
  ['2026-09-11T10:00:00Z', '2026-08-31T21:00:00.000Z', '2026-09-10T21:00:00.000Z'],
  ['2026-09-30T22:00:00Z', '2026-09-30T21:00:00.000Z', '2026-09-30T21:00:00.000Z'],
  ['2026-12-31T21:00:00Z', '2026-12-31T21:00:00.000Z', '2026-12-31T21:00:00.000Z'],
])('uses Minsk calendar boundaries at %s', (now, monthStart, dayStart) => {
  expect(minskQuotaBoundaries(new Date(now))).toEqual({ monthStart, dayStart });
});
function db(result: any, rows: any[] = []) {
  return { from: vi.fn(() => {
    let since = ''; let start = 0; let end = 999;
    const q: any = {
      select: vi.fn(() => q), eq: () => q, is: () => q,
      order: () => q, range: (a: number, b: number) => { start = a; end = b; return q; },
      gte: (_: string, value: string) => { since = value; return q; },
      then: (resolve: any) => resolve(result ?? { error: null, count: rows.filter(r => r.created_at >= since && !r.metadata?.denial_reason).length, data: rows.slice(start, end + 1) }),
    }; return q;
  }) };
}
it('counts the first calendar day and uses exact counts beyond the API row limit', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T10:00:00Z'));
  const rows = Array.from({ length: 1201 }, () => ({ created_at: '2026-09-01T09:00:00Z' }));
  expect(await countUserMessages(db(null, rows), 'u', { ai_mode: 'chat' })).toEqual({ daily: 0, monthly: 1201 });
});
it.each([
  { error: { message: 'database unavailable' }, data: null, count: null },
  { error: null, data: null, count: null },
])('fails closed when quota reads are unavailable: %j', async result => {
  await expect(countUserMessages(db(result), 'u', {})).rejects.toThrow('Не удалось проверить лимит');
  await expect(countChatMessagesLastMinute(db(result), 'u')).rejects.toThrow('Не удалось проверить лимит');
  await expect(sumChatContextCharsToday(db(result), 'u')).rejects.toThrow('Не удалось проверить лимит');
});
it('reads all context-budget pages', async () => {
  const rows = Array.from({ length: 1001 }, () => ({ metadata: { context_chars: 250 } }));
  expect(await sumChatContextCharsToday(db(null, rows), 'u')).toBe(250250);
});
it('accepts a successful zero count', async () => {
  expect(await countChatMessagesLastMinute(db({ count: 0, error: null }), 'u')).toBe(0);
});
