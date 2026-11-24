import { assertEquals } from "jsr:@std/assert@1";
import { stripeRecurringPeriod } from "./stripe-recurring-period.ts";
Deno.test("fixed-day billing preserves ten and thirty days instead of silently charging daily", () => {
  for (const days of [1, 10, 30, 31, 365]) {
    assertEquals(
      stripeRecurringPeriod({
        billing_period_mode: "days",
        billing_period_days: days,
      }),
      { interval: "day", interval_count: days },
    );
  }
  assertEquals(stripeRecurringPeriod({ recurring_interval_days: 30 }), {
    interval: "day",
    interval_count: 30,
  });
});
Deno.test("calendar-month billing remains calendar-month billing", () => {
  assertEquals(
    stripeRecurringPeriod({
      billing_period_mode: "month",
      billing_period_days: 10,
    }),
    { interval: "month", interval_count: 1 },
  );
});
Deno.test("invalid fixed intervals fail closed", () => {
  for (const days of [0, -1, 1.5, 366, "bad", Infinity]) {
    assertEquals(
      stripeRecurringPeriod({
        billing_period_mode: "days",
        billing_period_days: days,
      }),
      null,
    );
  }
  assertEquals(
    stripeRecurringPeriod({
      billing_period_mode: "bad",
      billing_period_days: 30,
    }),
    null,
  );
});
