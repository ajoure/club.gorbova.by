/**
 * Unit-тесты smart-date prefill resolver (PATCH-PACKAGE-CUSTOM-FIELDS-V1 итерация 2, C1).
 * Mock'аем Date через vi.useFakeTimers + setSystemTime в нужные точки.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveSmartDatePrefill,
  allowedSmartDateKindsForType,
  isSmartDateKindAllowedForType,
} from './smartDate';

// Используем UTC-полночь — Europe/Minsk = UTC+3 круглый год (после 2011).
// Чтобы получить локальное "2026-06-16 12:00 Minsk" — мокаем 2026-06-16T09:00Z.
function setNow(iso: string) { vi.setSystemTime(new Date(iso)); }

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('resolveSmartDatePrefill — current period anchors', () => {
  it('today=2026-06-16', () => {
    setNow('2026-06-16T09:00:00Z');
    expect(resolveSmartDatePrefill('today')).toBe('2026-06-16');
  });
  it('tomorrow / yesterday', () => {
    setNow('2026-06-16T09:00:00Z');
    expect(resolveSmartDatePrefill('tomorrow')).toBe('2026-06-17');
    expect(resolveSmartDatePrefill('yesterday')).toBe('2026-06-15');
  });
});

describe('resolveSmartDatePrefill — month shifts (4 new kinds)', () => {
  it('mid-Q2 2026-06-16', () => {
    setNow('2026-06-16T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_prev_month')).toBe('2026-05-01');
    expect(resolveSmartDatePrefill('last_day_of_prev_month')).toBe('2026-05-31');
    expect(resolveSmartDatePrefill('first_day_of_next_month')).toBe('2026-07-01');
    expect(resolveSmartDatePrefill('last_day_of_next_month')).toBe('2026-07-31');
  });
  it('январь → прошлый месяц = декабрь предыдущего года', () => {
    setNow('2026-01-15T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_prev_month')).toBe('2025-12-01');
    expect(resolveSmartDatePrefill('last_day_of_prev_month')).toBe('2025-12-31');
  });
  it('декабрь → будущий месяц = январь следующего года', () => {
    setNow('2026-12-20T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_next_month')).toBe('2027-01-01');
    expect(resolveSmartDatePrefill('last_day_of_next_month')).toBe('2027-01-31');
  });
  it('високосный февраль 2024-02-29', () => {
    setNow('2024-02-29T09:00:00Z');
    expect(resolveSmartDatePrefill('last_day_of_prev_month')).toBe('2024-01-31');
    expect(resolveSmartDatePrefill('last_day_of_next_month')).toBe('2024-03-31');
  });
  it('конец января 2025-01-31 → first_day_of_next_month = 2025-02-01 (никаких "31 февраля")', () => {
    setNow('2025-01-31T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_next_month')).toBe('2025-02-01');
    expect(resolveSmartDatePrefill('last_day_of_next_month')).toBe('2025-02-28');
  });
});

describe('resolveSmartDatePrefill — quarter shifts (4 new kinds)', () => {
  it('Q1 2026-02-10 → prev = Q4 2025, next = Q2 2026', () => {
    setNow('2026-02-10T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_prev_quarter')).toBe('2025-10-01');
    expect(resolveSmartDatePrefill('last_day_of_prev_quarter')).toBe('2025-12-31');
    expect(resolveSmartDatePrefill('first_day_of_next_quarter')).toBe('2026-04-01');
    expect(resolveSmartDatePrefill('last_day_of_next_quarter')).toBe('2026-06-30');
  });
  it('Q4 2026-11-10 → prev = Q3 2026, next = Q1 2027', () => {
    setNow('2026-11-10T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_prev_quarter')).toBe('2026-07-01');
    expect(resolveSmartDatePrefill('last_day_of_prev_quarter')).toBe('2026-09-30');
    expect(resolveSmartDatePrefill('first_day_of_next_quarter')).toBe('2027-01-01');
    expect(resolveSmartDatePrefill('last_day_of_next_quarter')).toBe('2027-03-31');
  });
});

describe('resolveSmartDatePrefill — year shifts (3 new kinds)', () => {
  it('mid-year 2026-06-16', () => {
    setNow('2026-06-16T09:00:00Z');
    expect(resolveSmartDatePrefill('prev_year')).toBe('2025');
    expect(resolveSmartDatePrefill('current_year')).toBe('2026');
    expect(resolveSmartDatePrefill('next_year')).toBe('2027');
  });
  it('31 декабря 2025 → next_year = "2026"', () => {
    setNow('2025-12-31T18:00:00Z');
    expect(resolveSmartDatePrefill('next_year')).toBe('2026');
  });
  it('1 января 2026 → prev_year = "2025"', () => {
    setNow('2026-01-01T05:00:00Z');
    expect(resolveSmartDatePrefill('prev_year')).toBe('2025');
  });
});

describe('resolveSmartDatePrefill — datetime contract', () => {
  it('start anchor → 00:00:00.000', () => {
    setNow('2026-06-16T09:00:00Z');
    expect(resolveSmartDatePrefill('first_day_of_next_month', { dataType: 'datetime' }))
      .toBe('2026-07-01T00:00:00.000');
    expect(resolveSmartDatePrefill('today', { dataType: 'datetime' }))
      .toBe('2026-06-16T00:00:00.000');
  });
  it('end anchor → 23:59:59.999', () => {
    setNow('2026-06-16T09:00:00Z');
    expect(resolveSmartDatePrefill('last_day_of_next_month', { dataType: 'datetime' }))
      .toBe('2026-07-31T23:59:59.999');
    expect(resolveSmartDatePrefill('last_day_of_next_quarter', { dataType: 'datetime' }))
      .toBe('2026-09-30T23:59:59.999');
  });
});

describe('allowedSmartDateKindsForType — UI фильтр', () => {
  it('year — только none + 3 year-shift', () => {
    expect(allowedSmartDateKindsForType('year')).toEqual(['none','prev_year','current_year','next_year']);
  });
  it('date включает 4+4 month/quarter shifts и year-anchors, но НЕ prev_year/current_year/next_year', () => {
    const list = allowedSmartDateKindsForType('date');
    expect(list).toContain('first_day_of_next_month');
    expect(list).toContain('last_day_of_next_quarter');
    expect(list).toContain('first_day_of_year');
    expect(list).not.toContain('prev_year');
    expect(list).not.toContain('current_year');
    expect(list).not.toContain('next_year');
  });
  it('datetime список == date', () => {
    expect(allowedSmartDateKindsForType('datetime')).toEqual(allowedSmartDateKindsForType('date'));
  });
  it('text/number/select/checkbox — пустой список (селект скрыт)', () => {
    expect(allowedSmartDateKindsForType('text')).toEqual([]);
    expect(allowedSmartDateKindsForType('number')).toEqual([]);
    expect(allowedSmartDateKindsForType('select')).toEqual([]);
    expect(allowedSmartDateKindsForType('checkbox')).toEqual([]);
  });
});

describe('isSmartDateKindAllowedForType — авто-сброс на смене типа', () => {
  it('year → date: prev_year несовместим', () => {
    expect(isSmartDateKindAllowedForType('prev_year', 'date')).toBe(false);
  });
  it('date → year: first_day_of_next_month несовместим', () => {
    expect(isSmartDateKindAllowedForType('first_day_of_next_month', 'year')).toBe(false);
  });
  it('date → text: ничего не разрешено', () => {
    expect(isSmartDateKindAllowedForType('today', 'text')).toBe(false);
  });
  it('none разрешён всегда (для year/date/datetime)', () => {
    expect(isSmartDateKindAllowedForType('none', 'year')).toBe(true);
    expect(isSmartDateKindAllowedForType('none', 'date')).toBe(true);
  });
});
