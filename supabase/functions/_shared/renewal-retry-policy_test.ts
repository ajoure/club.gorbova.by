import {
  accessDayHasEnded,
  isRetryExhausted,
  resolveEffectiveRetryPolicy,
} from "./renewal-retry-policy.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("finite installment policy wins over defaults", () => {
  const policy = resolveEffectiveRetryPolicy({
    installment: { retry_policy: { mode: "limited", configured_value: 6 } },
  });
  assertEquals(policy, {
    mode: "limited",
    maxAttempts: 6,
    source: "installment_snapshot",
  });
  assertEquals(isRetryExhausted(5, policy), false);
  assertEquals(isRetryExhausted(6, policy), true);
});

Deno.test("explicit unlimited policy never exhausts locally", () => {
  const policy = resolveEffectiveRetryPolicy({
    retry_policy: {
      mode: "unlimited_requested",
      configured_value: 0,
      provider_number_payment_attempts: 999,
    },
  });
  assertEquals(policy.maxAttempts, null);
  assertEquals(isRetryExhausted(1000, policy), false);
});

Deno.test("access is valid until the end of the Minsk calendar day", () => {
  const accessEnd = "2026-07-26T08:00:00.000Z";
  assertEquals(accessDayHasEnded(accessEnd, "2026-07-26T20:59:59.999Z"), false);
  assertEquals(accessDayHasEnded(accessEnd, "2026-07-26T21:00:00.000Z"), true);
});
