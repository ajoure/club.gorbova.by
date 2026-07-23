import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveStaleAccessPolicy } from "./stale_access_policy.ts";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const PAST_END = new Date("2026-02-11T12:00:00.000Z");
const FUTURE_END = new Date("2026-08-23T12:00:00.000Z");

Deno.test("historical recovery preserves the expired canonical window", () => {
  const result = resolveStaleAccessPolicy({
    canonicalAccessEndAt: PAST_END,
    now: NOW,
    context: "historical_payment_recovery",
    shouldAutoRenew: false,
  });
  assertEquals(result.accessEndAt.toISOString(), PAST_END.toISOString());
  assertEquals(result.nextChargeAt, null);
  assertEquals(result.status, "expired");
  assertEquals(result.placeholderApplied, false);
});

Deno.test("live stale flow retains the 48-hour synchronization guard", () => {
  const result = resolveStaleAccessPolicy({
    canonicalAccessEndAt: PAST_END,
    now: NOW,
    context: "subscription_renewal",
    shouldAutoRenew: true,
  });
  assertEquals(result.accessEndAt.toISOString(), "2026-07-25T12:00:00.000Z");
  assertEquals(result.nextChargeAt?.toISOString(), PAST_END.toISOString());
  assertEquals(result.status, "active");
  assertEquals(result.placeholderApplied, true);
});

Deno.test("future live flow preserves the existing next-charge contract", () => {
  const result = resolveStaleAccessPolicy({
    canonicalAccessEndAt: FUTURE_END,
    now: NOW,
    context: "standard",
    shouldAutoRenew: false,
  });
  assertEquals(result.accessEndAt.toISOString(), FUTURE_END.toISOString());
  assertEquals(result.nextChargeAt?.toISOString(), FUTURE_END.toISOString());
  assertEquals(result.status, "active");
});
