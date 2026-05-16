import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { dedupeExtendedByOrders } from './extended_by_orders_dedupe.ts';

Deno.test('H2 dedupe: empty existing → append', () => {
  const r = dedupeExtendedByOrders(undefined, 'order-A');
  assertEquals(r.duplicate, false);
  assertEquals(r.next, ['order-A']);
});

Deno.test('H2 dedupe: append new order_id', () => {
  const r = dedupeExtendedByOrders(['order-X'], 'order-A');
  assertEquals(r.duplicate, false);
  assertEquals(r.next, ['order-X', 'order-A']);
});

Deno.test('H2 dedupe: same order_id ignored (duplicate)', () => {
  const r = dedupeExtendedByOrders(['68e2c243'], '68e2c243');
  assertEquals(r.duplicate, true);
  assertEquals(r.next, ['68e2c243']);
});

Deno.test('H2 dedupe: existing array already has duplicate (heals it)', () => {
  // Воспроизводит реальный кейс PATCH H: [68e2c243, 68e2c243].
  const r = dedupeExtendedByOrders(['68e2c243', '68e2c243'], '68e2c243');
  assertEquals(r.duplicate, true);
  assertEquals(r.normalized_existing, ['68e2c243']);
  assertEquals(r.next, ['68e2c243']);
});

Deno.test('H2 dedupe: heal pre-existing dupes, add new', () => {
  const r = dedupeExtendedByOrders(['A', 'A', 'B'], 'C');
  assertEquals(r.duplicate, false);
  assertEquals(r.next, ['A', 'B', 'C']);
});

Deno.test('H2 dedupe: ignore non-string garbage in existing', () => {
  const r = dedupeExtendedByOrders(['A', null, undefined, 123, ''] as unknown[], 'B');
  assertEquals(r.duplicate, false);
  assertEquals(r.next, ['A', 'B']);
});
