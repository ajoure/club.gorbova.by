// B9. Canonical installment amount calculation in kopecks.
// Client mirror: src/lib/calculateInstallmentPlan.ts — keep in sync.

export type InstallmentPlanInput = {
  total_amount_kopecks: number;
  selected_cycles: number;
};

export type InstallmentPlanResult = {
  per_payment_kopecks: number;
  effective_total_kopecks: number;
  rounding_delta_kopecks: number;
  rounding_mode: "ceil_to_whole_byn";
  cycles: number;
};

export class InstallmentPlanError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Split a total amount into N equal per-cycle installments in kopecks.
 * Rounding: half-up on per-payment kopecks. rounding_delta = effective_total - requested_total.
 * Guardrail: abs(rounding_delta) < N (else invalid_installment_rounding).
 * Uniform cycles are required by bePaid provider-managed subscription plan.amount.
 */
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
  // B9. Округление ВВЕРХ до целых BYN: per_payment = ceil(total_byn / N).
  const totalByn = total / 100;
  const perPaymentByn = Math.ceil(totalByn / cycles);
  const perPayment = perPaymentByn * 100;
  const effectiveTotal = perPayment * cycles;
  const rounding = effectiveTotal - total;
  if (Math.abs(rounding) >= cycles * 100) {
    throw new InstallmentPlanError(
      "invalid_installment_rounding",
      `rounding_delta=${rounding} kopecks exceeds cycles*100=${cycles * 100}`,
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

export function kopecksToDecimal(k: number): number {
  return Math.round(k) / 100;
}

export function decimalToKopecks(amount: number): number {
  return Math.round(amount * 100);
}
