import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { classifyGeneration } from './generation-status.ts';

const baseFacts = {
  order_id: 'order-uuid',
  is_refund: false,
  stripe_account_resolved: true,
  internal_documents: [],
  scenario_found: true,
};

Deno.test('classifyGeneration: TEST_PAYMENT_DOCUMENT_BLOCKED имеет высший приоритет', () => {
  const r = classifyGeneration({ ...baseFacts, is_test_fixture: true });
  assertEquals(r.can_generate, false);
  assertEquals(r.blocked_reason, 'TEST_PAYMENT_DOCUMENT_BLOCKED');
});

Deno.test('classifyGeneration: fixture даже без scenario → TEST_PAYMENT_DOCUMENT_BLOCKED', () => {
  const r = classifyGeneration({ ...baseFacts, scenario_found: false, is_test_fixture: true });
  assertEquals(r.blocked_reason, 'TEST_PAYMENT_DOCUMENT_BLOCKED');
});

Deno.test('classifyGeneration: без fixture поведение прежнее', () => {
  const r = classifyGeneration({ ...baseFacts });
  assertEquals(r.can_generate, true);
  assertEquals(r.blocked_reason, null);
});

Deno.test('classifyGeneration: fixture=false не блокирует', () => {
  const r = classifyGeneration({ ...baseFacts, is_test_fixture: false });
  assertEquals(r.can_generate, true);
});

Deno.test('classifyGeneration: refund отдаёт REFUND_USES_PARENT_DOCUMENTS если нет fixture', () => {
  const r = classifyGeneration({ ...baseFacts, is_refund: true });
  assertEquals(r.blocked_reason, 'REFUND_USES_PARENT_DOCUMENTS');
});
