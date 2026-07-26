import { assert } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("already-fulfilled replay retries idempotent purchase notifications", () => {
  const guard = source.indexOf("already_fulfilled: true");
  const preceding = source.lastIndexOf(
    "await triggerOrderPurchasedNotification(orderId)",
    guard,
  );
  assert(guard > 0);
  assert(preceding > 0);
});

Deno.test("normal grant and replay share one notification helper", () => {
  assert(source.includes(
    "async function triggerOrderPurchasedNotification(orderId: string)",
  ));
  assert(
    (source.match(/await triggerOrderPurchasedNotification\(orderId\)/g) || [])
      .length >= 2,
  );
  assert(source.includes("/functions/v1/notify-order-purchased"));
});
