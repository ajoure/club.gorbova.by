import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

Deno.test("manual payment enters canonical finalizer after order becomes paid", () => {
  assert(source.includes('from "../_shared/finalize-composable-purchase.ts"'));
  assert(source.includes('from "../_shared/crm-routing.ts"'));
  assert(source.includes('orderAfterPayment?.status === "paid"'));
  assert(source.includes("finalizeComposablePurchase(admin"));
  assert(source.includes("applyCrmStageOnTerminal("));
  assert(source.includes('"admin_manual_payment_paid"'));
  assert(source.includes('source: "admin-create-manual-payment"'));
});

Deno.test("partial manual payment does not grant access early", () => {
  const paidGate = source.indexOf('orderAfterPayment?.status === "paid"');
  const finalizeCall = source.indexOf("finalizeComposablePurchase(admin");
  const stageCall = source.indexOf("applyCrmStageOnTerminal(");
  const awaiting = source.indexOf('state: "awaiting_full_payment"');
  assert(paidGate >= 0);
  assert(finalizeCall > paidGate);
  assert(stageCall > finalizeCall);
  assert(awaiting > stageCall);
});

Deno.test("fulfillment result is returned to admin UI", () => {
  assertEquals((source.match(/\bfulfillment,\s*$/gm) || []).length, 1);
  assert(source.includes("payment_written: true"));
  assert(source.includes("downstream_complete: downstreamComplete"));
  assert(source.includes("downstream_retryable: downstreamRetryable"));
  assert(source.includes("crm_stage: crmStage"));
});

Deno.test("downstream failure never hides an already written payment behind HTTP 500", () => {
  assert(source.includes('error_code: "manual_payment_fulfillment_failed"'));
  assert(source.includes("downstreamRetryable = true"));
  assert(
    !source.includes('return bad(500, "manual_payment_fulfillment_failed"'),
  );
  assert(
    !source.includes('return bad(500, "manual_payment_order_reload_failed"'),
  );
});
