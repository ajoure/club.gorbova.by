// B1. Client mirror of supabase/functions/_shared/charge-notification-policy.ts.
// Used by admin UI (ChargeNotificationSettings) to read/write canonical meta.

export type ChargeNotificationPolicy = {
  enabled: boolean;
  reminder_days: number[];
  timezone: string;
  notify_on_failure: boolean;
  notify_on_retry_exhausted: boolean;
};

export const DEFAULT_CHARGE_NOTIFICATION_POLICY: ChargeNotificationPolicy = {
  enabled: true,
  reminder_days: [7, 3, 1],
  timezone: "Europe/Minsk",
  notify_on_failure: true,
  notify_on_retry_exhausted: true,
};

export const REMINDER_DAY_OPTIONS = [7, 3, 1] as const;

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Europe/Minsk", label: "Минск (UTC+3)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Kiev", label: "Киев (UTC+2/+3)" },
  { value: "Europe/Warsaw", label: "Варшава (UTC+1/+2)" },
  { value: "UTC", label: "UTC" },
];

const ALLOWED = new Set<number>([1, 3, 7]);

function sanitizeDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = Array.from(
    new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && ALLOWED.has(n))),
  ).sort((a, b) => b - a);
  return out.length ? out : null;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/**
 * Read policy from meta with legacy fallback.
 * Precedence: meta.charge_notifications → meta.installment.charge_notifications
 *   → meta.recurring.{pre_due_reminders_days, notify_before_each_charge, notify_grace_events, timezone}
 *   → defaults.
 */
export function readChargeNotificationPolicy(meta: unknown): ChargeNotificationPolicy {
  const m = (meta ?? {}) as Record<string, unknown>;
  const canonical = (m.charge_notifications ??
    (m.installment as Record<string, unknown> | undefined)?.charge_notifications ??
    (m.recurring as Record<string, unknown> | undefined)?.charge_notifications) as
    | Record<string, unknown>
    | undefined;
  if (canonical && typeof canonical === "object") {
    return {
      enabled: asBool(canonical.enabled, true),
      reminder_days: sanitizeDays(canonical.reminder_days) ??
        DEFAULT_CHARGE_NOTIFICATION_POLICY.reminder_days,
      timezone: typeof canonical.timezone === "string" && canonical.timezone
        ? (canonical.timezone as string)
        : DEFAULT_CHARGE_NOTIFICATION_POLICY.timezone,
      notify_on_failure: asBool(canonical.notify_on_failure, true),
      notify_on_retry_exhausted: asBool(canonical.notify_on_retry_exhausted, true),
    };
  }
  const legacy = m.recurring as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === "object") {
    return {
      enabled: asBool(legacy.notify_before_each_charge, true),
      reminder_days: sanitizeDays(legacy.pre_due_reminders_days) ??
        DEFAULT_CHARGE_NOTIFICATION_POLICY.reminder_days,
      timezone: typeof legacy.timezone === "string" && legacy.timezone
        ? (legacy.timezone as string)
        : DEFAULT_CHARGE_NOTIFICATION_POLICY.timezone,
      notify_on_failure: asBool(legacy.notify_grace_events, true),
      notify_on_retry_exhausted: asBool(legacy.notify_grace_events, true),
    };
  }
  return { ...DEFAULT_CHARGE_NOTIFICATION_POLICY };
}

export function serializeChargeNotificationPolicy(
  p: ChargeNotificationPolicy,
): Record<string, unknown> {
  return {
    enabled: p.enabled,
    reminder_days: [...p.reminder_days].sort((a, b) => b - a),
    timezone: p.timezone,
    notify_on_failure: p.notify_on_failure,
    notify_on_retry_exhausted: p.notify_on_retry_exhausted,
  };
}
