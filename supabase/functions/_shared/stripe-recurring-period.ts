export type StripeRecurringPeriod = {
  interval: "day" | "week" | "month" | "year";
  interval_count: number;
};

/** Fixed-day offers must retain their count; calendar-month offers stay calendar based. */
export function stripeRecurringPeriod(
  rec: Record<string, unknown>,
): StripeRecurringPeriod | null {
  const raw = String(rec.billing_period_mode || "days").toLowerCase();
  const mode = raw.endsWith("s") ? raw.slice(0, -1) : raw;
  if (mode === "day") {
    const days = Number(
      rec.billing_period_days ?? rec.recurring_interval_days ?? 0,
    );
    if (!Number.isInteger(days) || days < 1 || days > 365) return null;
    return { interval: "day", interval_count: days };
  }
  if (mode === "week" || mode === "month" || mode === "year") {
    return { interval: mode, interval_count: 1 };
  }
  return null;
}
