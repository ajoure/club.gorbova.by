/**
 * TimerAdapter — ISO 8601 normalization and date parsing for timer blocks.
 * Editor calls normalizeToISO() before save.
 * Renderer calls parseTargetDate() for display and isExpired() for conditional rendering.
 */

export function normalizeToISO(dateInput: string): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function parseTargetDate(isoString: string): Date | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function isExpired(isoString: string): boolean {
  const target = parseTargetDate(isoString);
  if (!target) return true;
  return target.getTime() <= Date.now();
}

export interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

export function getTimeRemaining(isoString: string): TimeRemaining {
  const target = parseTargetDate(isoString);
  if (!target) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };

  const total = Math.max(0, target.getTime() - Date.now());
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days = Math.floor(total / (1000 * 60 * 60 * 24));

  return { days, hours, minutes, seconds, total };
}
