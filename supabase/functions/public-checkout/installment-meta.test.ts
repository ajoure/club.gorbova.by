import { assertEquals } from 'jsr:@std/assert@1';
import { buildFiniteInstallmentOrderMeta } from './installment-meta.ts';

Deno.test('copies the complete canonical finite-installment contract to the order', () => {
  const result = buildFiniteInstallmentOrderMeta({
    selected_installment_months: 6,
    per_payment_amount_byn: 339,
    interval_days: 30,
    max_installment_months: 12,
    rounding_delta_byn: 4,
    max_charge_attempts: 3,
    charge_notifications: { enabled: true },
  }) as Record<string, any>;

  assertEquals(result.payment_method, 'internal_installment');
  assertEquals(result.installment_count, 6);
  assertEquals(result.installment_per_payment_amount_byn, 339);
  assertEquals(result.installment_total_amount_byn, 2034);
  assertEquals(result.installment, {
    type: 'internal',
    provider: 'bepaid',
    model: 'bepaid_finite_subscription',
    infinite: false,
    payment_method: 'internal_installment',
    interval_days: 30,
    first_payment_delay_days: 0,
    rounding_mode: 'round_half_up_byn',
    max_installment_months: 12,
    source: 'payment_link',
    as_finite_subscription: true,
    billing_cycles: 6,
    per_payment_byn: 339,
    effective_total_byn: 2034,
    total_installment_amount: 2034,
    rounding_delta_byn: 4,
    max_charge_attempts: 3,
    retry_policy_mode: 'limited',
    charge_notifications: { enabled: true },
    charge_notifications_source: 'link',
  });
});

Deno.test('preserves explicit unlimited retry and rejects non-installment data', () => {
  const result = buildFiniteInstallmentOrderMeta({
    selected_installment_months: 2,
    per_payment_amount_byn: '100',
    max_charge_attempts: 0,
  }) as Record<string, any>;

  assertEquals(result.installment.retry_policy_mode, 'unlimited_requested');
  assertEquals(result.installment.max_charge_attempts, 0);
  assertEquals(buildFiniteInstallmentOrderMeta({
    selected_installment_months: 1,
    per_payment_amount_byn: 100,
  }), {});
});
