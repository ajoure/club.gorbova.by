import { assertEquals } from 'jsr:@std/assert@1';
import { checkAnyMonthPurchase } from './check-month-purchase.ts';

Deno.test('exact-tariff multi-month check uses one bulk RPC', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: [
          { lesson_id: 'live-access-month-0', has_purchase: false },
          { lesson_id: 'live-access-month-1', has_purchase: true },
        ],
        error: null,
      };
    },
  };

  const result = await checkAnyMonthPurchase(supabase as never, {
    user_id: 'user-id',
    tariff_id: 'tariff-id',
    months: ['2026-07', '2026-08'],
  });

  assertEquals(result, { passed: true, reason: 'matched' });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, 'has_month_purchase_bulk');
  assertEquals(calls[0].args._items, [
    {
      lesson_id: 'live-access-month-0',
      tariff_id: 'tariff-id',
      content_month: '2026-07',
    },
    {
      lesson_id: 'live-access-month-1',
      tariff_id: 'tariff-id',
      content_month: '2026-08',
    },
  ]);
});
