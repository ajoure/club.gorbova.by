import { formatInTimeZone } from 'date-fns-tz';

export type TimezoneMode = 'user' | 'utc' | 'provider';

/**
 * Format a payment timestamp based on timezone display mode
 * 
 * @param utcDate - ISO timestamp (stored in UTC in database)
 * @param mode - Display mode: 'user' (user's TZ), 'utc', or 'provider' (Europe/Minsk)
 * @param userTimezone - User's timezone from profile (default: Europe/Minsk)
 * @param formatStr - date-fns format string (default: dd.MM.yy HH:mm)
 * @returns Formatted date string
 */
export function formatPaymentTime(
  utcDate: string | null | undefined,
  mode: TimezoneMode,
  userTimezone: string = 'Europe/Minsk',
  formatStr: string = 'dd.MM.yy HH:mm'
): string {
  if (!utcDate) return '—';
  
  try {
    const date = new Date(utcDate);
    
    // Validate date
    if (isNaN(date.getTime())) {
      console.warn('[formatPaymentTime] Invalid date:', utcDate);
      return '—';
    }
    
    switch (mode) {
      case 'utc':
        return formatInTimeZone(date, 'UTC', formatStr);
      case 'provider':
        // bePaid operates in Europe/Minsk timezone
        return formatInTimeZone(date, 'Europe/Minsk', formatStr);
      case 'user':
      default:
        return formatInTimeZone(date, userTimezone, formatStr);
    }
  } catch (e) {
    console.error('[formatPaymentTime] Error formatting date:', e, utcDate);
    return '—';
  }
}

/**
 * Get timezone label for display
 */
export function getTimezoneLabel(mode: TimezoneMode, userTimezone: string = 'Europe/Minsk'): string {
  switch (mode) {
    case 'utc':
      return 'UTC';
    case 'provider':
      return 'Minsk (bePaid)';
    case 'user':
    default:
      return userTimezone.split('/').pop()?.replace('_', ' ') || userTimezone;
  }
}
