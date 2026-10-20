import { assertEquals, assertRejects } from "jsr:@std/assert";
import { requireExactGrantCapability } from "./grant-capability.ts";

Deno.test("continuation probes only the existing authenticated GET capability", async () => {
  const calls: unknown[] = [];
  await requireExactGrantCapability({ functions: { invoke: async (...args) => {
    calls.push(args);
    return { data: { capabilities: { exact_existing_access_v1: true } } };
  } } });
  assertEquals(calls, [['grant-access-for-order', { method: 'GET' }]]);
});

for (const [name, result] of [
  ['unauthorized', { error: { status: 401 } }],
  ['old deployment', { data: { error: 'orderId_required' } }],
  ['false capability', { data: { capabilities: { exact_existing_access_v1: false } } }],
  ['string capability', { data: { capabilities: { exact_existing_access_v1: 'true' } } }],
  ['error despite capability', { data: { capabilities: { exact_existing_access_v1: true } }, error: {} }],
] as const) {
  Deno.test(`continuation fails closed on ${name}`, async () => {
    await assertRejects(() => requireExactGrantCapability({ functions: { invoke: async () => result } }),
      Error, 'recovery_exact_grant_capability_unavailable');
  });
}

Deno.test("network failure is sanitized and never permits a grant", async () => {
  await assertRejects(() => requireExactGrantCapability({ functions: { invoke: async () => {
    throw new Error('private upstream response must not leak');
  } } }), Error, 'recovery_exact_grant_capability_unavailable');
});
