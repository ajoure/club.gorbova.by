export type InstallmentLinkMeta = Record<string, unknown>;

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Transposes the canonical finite-installment snapshot from payment_links.meta
 * to orders_v2.meta. The contact installment UI and the bePaid webhook both
 * read this contract from the order, so dropping any of these markers makes a
 * valid finite plan look like an ordinary recurring subscription.
 */
export function buildFiniteInstallmentOrderMeta(
  linkInstallment: InstallmentLinkMeta | null,
): Record<string, unknown> {
  const billingCycles = optionalFiniteNumber(linkInstallment?.selected_installment_months);
  const perPaymentByn = optionalFiniteNumber(linkInstallment?.per_payment_amount_byn);

  if (!linkInstallment || !billingCycles || billingCycles < 2 || perPaymentByn === undefined) {
    return {};
  }

  const effectiveTotalByn = perPaymentByn * billingCycles;
  const roundingDeltaByn = optionalFiniteNumber(linkInstallment.rounding_delta_byn);
  const maxChargeAttempts = optionalFiniteNumber(linkInstallment.max_charge_attempts);

  return {
    payment_method: 'internal_installment',
    installment_count: billingCycles,
    installment_per_payment_amount_byn: perPaymentByn,
    installment_total_amount_byn: effectiveTotalByn,
    installment: {
      type: 'internal',
      provider: 'bepaid',
      model: 'bepaid_finite_subscription',
      infinite: false,
      payment_method: 'internal_installment',
      interval_days: optionalFiniteNumber(linkInstallment.interval_days) ?? 30,
      first_payment_delay_days: optionalFiniteNumber(linkInstallment.first_payment_delay_days) ?? 0,
      rounding_mode: String(linkInstallment.rounding_mode ?? 'round_half_up_byn'),
      max_installment_months:
        optionalFiniteNumber(linkInstallment.max_installment_months) ?? billingCycles,
      source: 'payment_link',
      as_finite_subscription: true,
      billing_cycles: billingCycles,
      per_payment_byn: perPaymentByn,
      effective_total_byn: effectiveTotalByn,
      total_installment_amount: effectiveTotalByn,
      ...(roundingDeltaByn === undefined ? {} : { rounding_delta_byn: roundingDeltaByn }),
      max_charge_attempts: maxChargeAttempts ?? null,
      retry_policy_mode:
        linkInstallment.retry_policy_mode ??
        (maxChargeAttempts === undefined
          ? 'provider_default'
          : maxChargeAttempts === 0
            ? 'unlimited_requested'
            : 'limited'),
      ...(linkInstallment.charge_notifications
        ? {
            charge_notifications: linkInstallment.charge_notifications,
            charge_notifications_source:
              linkInstallment.charge_notifications_source ?? 'link',
          }
        : {}),
    },
  };
}
