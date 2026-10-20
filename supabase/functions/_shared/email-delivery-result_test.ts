import { assertEquals } from 'jsr:@std/assert@1';
import { invokeEmailDelivery } from './email-delivery-result.ts';

Deno.test('only actual sender acceptance or accepted idempotent replay is a delivery', async () => {
  assertEquals(await invokeEmailDelivery(async () => ({ data: { success: true }, error: null })), { sent: true });
  assertEquals((await invokeEmailDelivery(async () => ({ data: {}, error: null }))).sent, false);
  assertEquals((await invokeEmailDelivery(async () => ({ data: { success: false }, error: null }))).sent, false);
});
Deno.test('HTTP authorization failures preserve status and stage without leaking response text', async () => {
  const outcome = await invokeEmailDelivery(async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'private@example.test' }), { status: 401 }) } }));
  assertEquals(outcome, { sent: false, error_stage: 'authorization', http_status: 401, error_code: 'sender_http_401' });
});
Deno.test('SMTP rejection and transport errors are failures, never queued success', async () => {
  const outcome = await invokeEmailDelivery(async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'SMTP authentication failed (535). private@example.test' }), { status: 500 }) } }));
  assertEquals(outcome, { sent: false, error_stage: 'smtp', http_status: 500, error_code: 'smtp_rejected_535' });
  assertEquals(await invokeEmailDelivery(async () => { throw new Error('secret'); }), { sent: false, error_stage: 'invoke', error_code: 'sender_invocation_failed' });
});
