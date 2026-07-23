import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const autoProcessSource = await Deno.readTextFile(
  new URL("../bepaid-auto-process/index.ts", import.meta.url),
);
const queueCronSource = await Deno.readTextFile(
  new URL("../bepaid-queue-cron/index.ts", import.meta.url),
);

Deno.test("recurring bePaid tracking IDs use the shared parser", () => {
  assertStringIncludes(source, "parseBepaidTrackingId(item.tracking_id).orderId");
  assert(!source.includes("item.tracking_id.split('_')"));
});

Deno.test("queue completion is blocked until payments_v2 is persisted", () => {
  const writer = source.indexOf('.from("payments_v2")\n    .upsert(paymentRow');
  const verification = source.indexOf('throw new Error(`payments_v2 verification failed:');
  const completion = source.indexOf('.update({\n      status: "completed"');

  assert(writer >= 0, "canonical payments_v2 upsert is required");
  assert(verification > writer, "persistence verification must follow the write");
  assert(completion > verification, "queue may complete only after persistence verification");
});

Deno.test("bePaid auto-process verifies payments_v2 before completing queue", () => {
  assertStringIncludes(autoProcessSource, "await ensureCanonicalPayment(");
  assertStringIncludes(autoProcessSource, "payments_v2 verification failed:");
  assert(!autoProcessSource.includes("await supabase.from('payments_v2').insert({"));
});

Deno.test("recurring recovery resolves catalog from subscriptions_v2", () => {
  assertStringIncludes(autoProcessSource, "parseBepaidTrackingId(item.tracking_id)");
  assertStringIncludes(autoProcessSource, ".from('subscriptions_v2')");
  assertStringIncludes(autoProcessSource, "resolved_from_subscriptions_v2");
  assertStringIncludes(autoProcessSource, "matchedBy = 'subscription_tracking_id'");
});

Deno.test("queue cron forwards its internal credential and supports exact recovery", () => {
  assertStringIncludes(queueCronSource, 'headers: { "x-internal-key": cronSecret }');
  assertStringIncludes(queueCronSource, 'query = query.eq("id", queueItemId)');
  assertStringIncludes(queueCronSource, "queueItemId ? 1 : batchSize");
});
