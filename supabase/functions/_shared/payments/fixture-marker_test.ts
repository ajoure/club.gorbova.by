import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isTestFixturePayment, withFixtureMarker } from './fixture-marker.ts';

Deno.test('isTestFixturePayment: null/undefined → false', () => {
  assertEquals(isTestFixturePayment(null), false);
  assertEquals(isTestFixturePayment(undefined), false);
});

Deno.test('isTestFixturePayment: no meta → false', () => {
  assertEquals(isTestFixturePayment({}), false);
  assertEquals(isTestFixturePayment({ meta: null }), false);
});

Deno.test('isTestFixturePayment: meta.fixture === true → true', () => {
  assertEquals(isTestFixturePayment({ meta: { fixture: true } }), true);
});

Deno.test('isTestFixturePayment: ТОЛЬКО boolean true, не строка / число', () => {
  assertEquals(isTestFixturePayment({ meta: { fixture: 'true' } }), false);
  assertEquals(isTestFixturePayment({ meta: { fixture: 1 } }), false);
  assertEquals(isTestFixturePayment({ meta: { fixture: false } }), false);
});

Deno.test('isTestFixturePayment: запрещены эвристики по сумме/email/дате (только meta.fixture)', () => {
  // Никаких alt-полей не должно срабатывать.
  assertEquals(isTestFixturePayment({ meta: { test_payment: true } }), false);
  assertEquals(isTestFixturePayment({ meta: { is_fixture: true } }), false);
  assertEquals(isTestFixturePayment({ meta: { technical: true } }), false);
  assertEquals(isTestFixturePayment({ meta: { stripe: { test_mode: true } } }), false);
});

Deno.test('withFixtureMarker: сохраняет существующие поля + добавляет audit', () => {
  const result = withFixtureMarker(
    { foo: 'bar', existing: 1 },
    'admin_manual',
    'user-uuid-1',
  );
  assertEquals(result.foo, 'bar');
  assertEquals(result.existing, 1);
  assertEquals(result.fixture, true);
  assertEquals(result.fixture_source, 'admin_manual');
  assertEquals(result.fixture_marked_by, 'user-uuid-1');
  assertEquals(typeof result.fixture_marked_at, 'string');
});

Deno.test('withFixtureMarker: null meta даёт чистый объект с marker', () => {
  const result = withFixtureMarker(null, 'historical_dry_run_backfill', null);
  assertEquals(result.fixture, true);
  assertEquals(result.fixture_marked_by, null);
});
