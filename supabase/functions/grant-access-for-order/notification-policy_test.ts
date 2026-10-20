import { assertEquals } from "jsr:@std/assert";
import { shouldNotifyTelegramCustomer } from "./notification-policy.ts";
Deno.test("only a verified service historical repair suppresses the customer Telegram notice", () => {
  assertEquals(shouldNotifyTelegramCustomer("service_role", "historical_payment_recovery", false), false);
  for (const role of ["admin", "ordinary_user", "anonymous"]) {
    assertEquals(shouldNotifyTelegramCustomer(role, "historical_payment_recovery", false), true);
  }
  assertEquals(shouldNotifyTelegramCustomer("service_role", "standard", false), true);
  assertEquals(shouldNotifyTelegramCustomer("service_role", "historical_payment_recovery", undefined), true);
});
