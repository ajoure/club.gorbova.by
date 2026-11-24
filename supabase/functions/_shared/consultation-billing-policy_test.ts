import { assertEquals } from "jsr:@std/assert@1";
import { consultationBillingPolicy } from "./consultation-billing-policy.ts";
Deno.test("consultation explicit subscription bills once per calendar month with a separate30day access window", () => {
  assertEquals(consultationBillingPolicy("consultation", "subscription"), {
    accessDays: 30,
    stripe: { interval: "month", interval_count: 1 },
    bepaid: { interval_unit: "month", interval: 1 },
  });
});
Deno.test("default and explicit one-time payments are never promoted to subscriptions", () => {
  for (const type of [undefined, null, "one_time"]) {
    assertEquals(consultationBillingPolicy("consultation", type), null);
  }
});
Deno.test("unrelated products and finite installment terms stay unchanged", () => {
  assertEquals(consultationBillingPolicy("club", "subscription"), null);
  assertEquals(
    consultationBillingPolicy("consultation", "subscription", true),
    null,
  );
});
