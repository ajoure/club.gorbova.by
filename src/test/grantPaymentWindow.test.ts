import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveGrantPaymentWindow, accessDateReachesWindow } from '../../supabase/functions/grant-access-for-order/payment_window';

describe('confirmed payment window is stable across replays', () => {
  it.each([true, false])('replay clock never changes the expected end (calendar=%s)', (calendarMonth) => {
    vi.useFakeTimers();
    try {
      const input = { paidAt: '2026-08-15T09:15:29Z', durationDays: 30, calendarMonth };
      vi.setSystemTime(new Date('2026-08-15T10:00:00Z'));
      const original = resolveGrantPaymentWindow(input);
      vi.setSystemTime(new Date('2026-08-31T10:00:00Z'));
      const replay = resolveGrantPaymentWindow(input);
      expect(replay.expectedEnd?.toISOString()).toBe(original.expectedEnd?.toISOString());
      expect(accessDateReachesWindow(original.expectedEnd?.toISOString(), replay.expectedEnd)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('preserves the previous paid period for delayed recurring recovery', () => {
    const window = resolveGrantPaymentWindow({
      paidAt: '2026-08-28T08:15:55Z', customStart: '2026-08-29T12:00:00Z',
      durationDays: 30, calendarMonth: true,
    });
    expect(window.expectedEnd?.toISOString()).toBe('2026-09-29T12:00:00.000Z');
  });
  it('clamps calendar month and honors an explicit target end', () => {
    const input = { paidAt: '2026-01-31T09:00:00Z', durationDays: 30, calendarMonth: true };
    expect(resolveGrantPaymentWindow(input).expectedEnd?.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(resolveGrantPaymentWindow({ ...input, customEnd: '2026-02-10T12:00:00Z' }).expectedEnd?.toISOString())
      .toBe('2026-02-10T12:00:00.000Z');
  });
  it('missing payment evidence cannot manufacture a new window or invalidate a legacy skip', () => {
    const window = resolveGrantPaymentWindow({ durationDays: 30, calendarMonth: true });
    expect(window).toEqual({ start: null, expectedEnd: null });
    expect(accessDateReachesWindow('2020-01-01T12:00:00Z', window.expectedEnd)).toBe(true);
  });
  it('rejects malformed explicit dates', () => {
    expect(() => resolveGrantPaymentWindow({ customStart: 'not-a-date', durationDays: 30, calendarMonth: true }))
      .toThrow('invalid_access_window');
  });
  it('handler uses one payments_v2 lookup before its replay guard and reuses it for granting', () => {
    const source = readFileSync('supabase/functions/grant-access-for-order/index.ts', 'utf8');
    expect(source).not.toContain('paidAtForSkipGuard');
    expect(source.match(/\.select\("paid_at"\)/g)).toHaveLength(1);
    expect(source.indexOf('paymentWindow = resolveGrantPaymentWindow')).toBeLessThan(source.indexOf('IDEMPOTENCY HARD GUARD'));
    expect(source).toContain('const baseStartDate = paymentWindow.start;');
  });
});
