// B9. Client mirror of supabase/functions/_shared/calculate-installment-plan.ts.
// Same rounding contract so UI preview matches server calculation.

export type InstallmentPlanInput = {
  total_amount_kopecks: number;
  selected_cycles: number;
};

export type InstallmentPlanResult = {
  per_payment_kopecks: number;
  effective_total_kopecks: number;
  rounding_delta_kopecks: number;
  rounding_mode: "round_half_up";
  cycles: number;
};

export class InstallmentPlanError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function calculateInstallmentPlan(
  input: InstallmentPlanInput,
): InstallmentPlanResult {
  const total = Number(input.total_amount_kopecks);
  const cycles = Number(input.selected_cycles);
  if (!Number.isInteger(total) || total <= 0) {
    throw new InstallmentPlanError(
      "invalid_installment_total",
      "total_amount_kopecks must be a positive integer",
    );
  }
  if (!Number.isInteger(cycles) || cycles < 2 || cycles > 60) {
    throw new InstallmentPlanError(
      "invalid_installment_cycles",
      "selected_cycles must be an integer in [2, 60]",
    );
  }
  const perPayment = Math.round(total / cycles);
  const effectiveTotal = perPayment * cycles;
  const rounding = effectiveTotal - total;
  if (Math.abs(rounding) >= cycles) {
    throw new InstallmentPlanError(
      "invalid_installment_rounding",
      `rounding_delta=${rounding} kopecks exceeds cycles=${cycles}`,
    );
  }
  return {
    per_payment_kopecks: perPayment,
    effective_total_kopecks: effectiveTotal,
    rounding_delta_kopecks: rounding,
    rounding_mode: "round_half_up",
    cycles,
  };
}

export const kopecksToDecimal = (k: number) => Math.round(k) / 100;
export const decimalToKopecks = (a: number) => Math.round(a * 100);

export function formatKopecksAsCurrency(k: number, currency = "BYN"): string {
  const value = kopecksToDecimal(k);
  return `${value.toFixed(2)} ${currency}`;
}
