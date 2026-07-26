import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

Deno.test("manual payment enters canonical finalizer after order becomes paid", () => {
  assert(source.includes('from("../_shared/finalize-composable-purchase.ts")'));
  assert(source.includes('orderAfterPayment?.status === "paid"'));
  assert(source.includes("finalizeComposablePurchase(admin"));
  assert(source.includes('source: "admin-create-manual-payment"'));
});

Deno.test("partial manual payment does not grant access early", () => {
  const paidGate = source.indexOf('orderAfterPayment?.status === "paid"');
  const finalizeCall = source.indexOf("finalizeComposablePurchase(admin");
  const awaiting = source.indexOf('state: "awaiting_full_payment"');
  assert(paidGate >= 0);
  assert(finalizeCall > paidGate);
  assert(awaiting > finalizeCall);
});

Deno.test("fulfillment result is returned to admin UI", () => {
  assertEquals((source.match(/\bfulfillment,\s*$/gm) || []).length, 1);
});
