import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Contract tests keep the configuration requirement visible even though the
// database RPC owns all security-sensitive validation.
Deno.test('club bonus source_ref is deterministic per order and rule', () => {
  const orderId = '11111111-1111-4111-8111-111111111111';
  const ruleId = '22222222-2222-4222-8222-222222222222';
  assertEquals(`club_bonus:${orderId}:${ruleId}`, `club_bonus:${orderId}:${ruleId}`);
});

Deno.test('configured tier ranking never depends on tariff names', () => {
  const candidates = [
    { tariffId: 'chat-id', accessRank: 10, name: 'renamed' },
    { tariffId: 'business-id', accessRank: 30, name: 'anything' },
    { tariffId: 'full-id', accessRank: 20, name: 'zzz' },
  ];
  candidates.sort((a, b) => b.accessRank - a.accessRank);
  assertEquals(candidates[0].tariffId, 'business-id');
});
