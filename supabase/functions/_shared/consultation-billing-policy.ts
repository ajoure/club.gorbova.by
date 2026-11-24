/** The website remains one-time by default. This policy applies only to an explicitly chosen subscription. */
export function consultationBillingPolicy(
  productCode: unknown,
  paymentType: unknown,
  finiteInstallment = false,
) {
  if (
    productCode !== "consultation" || paymentType !== "subscription" ||
    finiteInstallment
  ) return null;
  return {
    accessDays: 30,
    stripe: { interval: "month" as const, interval_count: 1 },
    bepaid: { interval_unit: "month" as const, interval: 1 },
  };
}
