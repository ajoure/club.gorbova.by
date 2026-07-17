// PATCH INSTALLMENT-RETRY-POLICY (client mirror).
// Каноническая семантика поля tariff_offers.meta.installment.max_charge_attempts.
// Держим синхронно с supabase/functions/_shared/installment-retry-policy.ts.

export type InstallmentRetryPolicy =
  | { mode: "provider_default"; configured_value: null; max_attempts: 3 }
  | { mode: "unlimited_requested"; configured_value: 0 }
  | { mode: "limited"; configured_value: number; max_attempts: number };

export const PROVIDER_DEFAULT_ATTEMPTS = 3 as const;

export function resolveInstallmentRetryPolicy(raw: unknown): InstallmentRetryPolicy {
  if (raw === null || raw === undefined || raw === "") {
    return { mode: "provider_default", configured_value: null, max_attempts: PROVIDER_DEFAULT_ATTEMPTS };
  }
  const v = Number(raw);
  if (v === 0) {
    return { mode: "unlimited_requested", configured_value: 0 };
  }
  if (!Number.isInteger(v) || v < 1 || v > 10) {
    throw new Error("invalid_installment_max_charge_attempts");
  }
  return { mode: "limited", configured_value: v, max_attempts: v };
}

// UI options для селекта.
// null           → «По умолчанию (3 попытки)» — bePaid default, capability gate не требуется.
// 0              → «Без ограничения» — потребует provider capability proof на checkout.
// 1..10          → явный лимит.
export type InstallmentAttemptsOption = { value: number | null; label: string };

export const INSTALLMENT_MAX_CHARGE_ATTEMPTS_OPTIONS: InstallmentAttemptsOption[] = [
  { value: null, label: "По умолчанию (3 попытки)" },
  // NB: «Без ограничения» (0) временно скрыто — provider capability не подтверждён.
  // При выборе 0 checkout возвращает controlled error provider_unlimited_attempts_not_supported.
  { value: 1, label: "1 попытка" },
  { value: 2, label: "2 попытки" },
  { value: 3, label: "3 попытки" },
  { value: 4, label: "4 попытки" },
  { value: 5, label: "5 попыток" },
  { value: 6, label: "6 попыток" },
  { value: 7, label: "7 попыток" },
  { value: 8, label: "8 попыток" },
  { value: 9, label: "9 попыток" },
  { value: 10, label: "10 попыток" },
];
