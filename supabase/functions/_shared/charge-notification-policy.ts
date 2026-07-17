// B1. Canonical policy for automatic-charge notifications (subscriptions + finite installments).
// Client mirror: src/lib/chargeNotificationPolicy.ts — keep in sync.

export type ChargeNotificationPolicy = {
  enabled: boolean;
  reminder_days: number[];
  timezone: string;
  notify_on_failure: boolean;
  notify_on_retry_exhausted: boolean;
  source: "canonical" | "legacy" | "defaults";
};

export const DEFAULT_CHARGE_NOTIFICATION_POLICY: ChargeNotificationPolicy = {
  enabled: true,
  reminder_days: [7, 3, 1],
  timezone: "Europe/Minsk",
  notify_on_failure: true,
  notify_on_retry_exhausted: true,
  source: "defaults",
};

const ALLOWED_REMINDER_DAYS = new Set([1, 3, 7]);

function sanitizeReminderDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = Array.from(
    new Set(
      raw
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && ALLOWED_REMINDER_DAYS.has(n)),
    ),
  ).sort((a, b) => b - a);
  return out.length ? out : null;
}

function sanitizeTimezone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/**
 * Resolve a ChargeNotificationPolicy from any meta bag.
 * Precedence:
 *  1) canonical:  meta.charge_notifications
 *  2) canonical:  meta.installment.charge_notifications
 *  3) legacy:     meta.recurring.{pre_due_reminders_days, notify_before_each_charge, notify_grace_events, timezone}
 *  4) defaults
 * Never throws; unknown fields ignored.
 */
export function resolveChargeNotificationPolicy(
  meta: unknown,
): ChargeNotificationPolicy {
  const m = (meta ?? {}) as Record<string, unknown>;
  const canonicalRoot = m.charge_notifications as Record<string, unknown> | undefined;
  const installment = m.installment as Record<string, unknown> | undefined;
  const canonicalInst = installment?.charge_notifications as
    | Record<string, unknown>
    | undefined;
  const canonical = canonicalRoot ?? canonicalInst;

  if (canonical && typeof canonical === "object") {
    const days = sanitizeReminderDays(canonical.reminder_days) ??
      DEFAULT_CHARGE_NOTIFICATION_POLICY.reminder_days;
    return {
      enabled: asBool(canonical.enabled, true),
      reminder_days: days,
      timezone: sanitizeTimezone(canonical.timezone) ??
        DEFAULT_CHARGE_NOTIFICATION_POLICY.timezone,
      notify_on_failure: asBool(canonical.notify_on_failure, true),
      notify_on_retry_exhausted: asBool(canonical.notify_on_retry_exhausted, true),
      source: "canonical",
    };
  }

  const legacy = m.recurring as Record<string, unknown> | undefined;
  if (legacy && typeof legacy === "object") {
    const enabled = asBool(legacy.notify_before_each_charge, true);
    const days = sanitizeReminderDays(legacy.pre_due_reminders_days) ??
      DEFAULT_CHARGE_NOTIFICATION_POLICY.reminder_days;
    return {
      enabled,
      reminder_days: days,
      timezone: sanitizeTimezone(legacy.timezone) ??
        DEFAULT_CHARGE_NOTIFICATION_POLICY.timezone,
      notify_on_failure: asBool(legacy.notify_grace_events, true),
      notify_on_retry_exhausted: asBool(legacy.notify_grace_events, true),
      source: "legacy",
    };
  }

  return { ...DEFAULT_CHARGE_NOTIFICATION_POLICY };
}

/**
 * Serialize a policy to the canonical meta shape (for writer snapshots).
 * `source` is not persisted; it is a runtime-only field.
 */
export function serializeChargeNotificationPolicy(
  policy: ChargeNotificationPolicy,
): Record<string, unknown> {
  return {
    enabled: policy.enabled,
    reminder_days: [...policy.reminder_days].sort((a, b) => b - a),
    timezone: policy.timezone,
    notify_on_failure: policy.notify_on_failure,
    notify_on_retry_exhausted: policy.notify_on_retry_exhausted,
  };
}

/**
 * Compose an installment.charge_notifications snapshot resolved by precedence:
 *   link snapshot → live offer → legacy recurring → defaults.
 * Used by writers (create-payment-checkout, admin-create-public-link).
 */
export function resolveChargeNotificationSnapshotForWriter(args: {
  linkMeta?: unknown;
  offerMeta?: unknown;
}): ChargeNotificationPolicy {
  const link = args.linkMeta ? resolveChargeNotificationPolicy(args.linkMeta) : null;
  if (link && link.source !== "defaults") return link;
  const offer = args.offerMeta ? resolveChargeNotificationPolicy(args.offerMeta) : null;
  if (offer && offer.source !== "defaults") return offer;
  return { ...DEFAULT_CHARGE_NOTIFICATION_POLICY };
}
