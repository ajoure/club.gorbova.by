import { calcCalendarMonthEnd } from '../_shared/resolve-access-window.ts';

// One payment-based clock for replay detection and the actual grant. Never NOW.
export function resolveGrantPaymentWindow(input: {
  paidAt?: string | null;
  customStart?: string | null;
  customEnd?: string | null;
  durationDays: number;
  calendarMonth: boolean;
}) {
  const parse = (value: string | null | undefined): Date | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const start = parse(input.customStart || input.paidAt);
  const explicitEnd = parse(input.customEnd);
  if ((input.customStart && !start) || (input.customEnd && !explicitEnd) ||
      !Number.isFinite(input.durationDays) || input.durationDays < 0) {
    throw new Error('invalid_access_window');
  }
  const expectedEnd = explicitEnd || (start
    ? input.calendarMonth ? calcCalendarMonthEnd(start)
      : new Date(start.getTime() + input.durationDays * 86_400_000)
    : null);
  return { start, expectedEnd };
}

export function accessDateReachesWindow(value: string | null | undefined, expectedEnd: Date | null) {
  // Missing legacy payment evidence must not turn an already fulfilled order
  // into a fresh extension. A NEW grant still requires a confirmed start date.
  if (!expectedEnd) return true;
  return !!value && Number.isFinite(Date.parse(value)) &&
    Date.parse(value) >= expectedEnd.getTime() - 12 * 60 * 60 * 1000;
}
