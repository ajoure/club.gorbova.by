// PATCH INSTALLMENT-RETRY-POLICY: единственный парсер политики повторных попыток.
//
// Каноническая бизнес-семантика (см. .lovable/plan.md §1):
//   • отсутствует / null / '' / 0 → mode='unlimited_requested' (намерение системы;
//     фактическая поддержка бесконечных попыток зависит от provider capability proof);
//   • 1..10                       → mode='limited' с точным конечным лимитом;
//   • всё остальное (отриц., дробное, >10, нечисло) → ошибка.
//
// ВАЖНО: `unlimited_requested` НЕ гарантирует бесконечные попытки на стороне bePaid.
// Документация bePaid однозначно указывает: если number_payment_attempts опущен,
// применяется default 3. Значение 0 как «без ограничения» в публичной документации
// не описано (docs.pay-cross.com). Поэтому production checkout ДОЛЖЕН пройти
// capability gate (см. resolveBepaidAttemptsValue) прежде чем отправлять что-либо
// в bePaid при mode='unlimited_requested'. Без proof — controlled error
// `provider_unlimited_attempts_not_supported`.

export type InstallmentRetryPolicy =
  | {
      mode: 'unlimited_requested';
      configured_value: 0;
    }
  | {
      mode: 'limited';
      configured_value: number;
      max_attempts: number;
    };

export function resolveInstallmentRetryPolicy(raw: unknown): InstallmentRetryPolicy {
  if (raw === null || raw === undefined || raw === '') {
    return { mode: 'unlimited_requested', configured_value: 0 };
  }
  const v = Number(raw);
  if (v === 0) {
    return { mode: 'unlimited_requested', configured_value: 0 };
  }
  if (!Number.isInteger(v) || v < 1 || v > 10) {
    throw new Error('invalid_installment_max_charge_attempts');
  }
  return { mode: 'limited', configured_value: v, max_attempts: v };
}

// Provider adapter для bePaid subscription API.
//
// Стратегии (см. §0/§6 плана):
//   • limited                      → payloadValue = policy.max_attempts;
//   • unlimited_requested + capability='native_zero'
//                                  → payloadValue = 0 (native infinite);
//   • unlimited_requested + capability={strategy:'large_sentinel', value:N}
//                                  → payloadValue = N;
//   • unlimited_requested + capability отсутствует / not_proven
//                                  → бросаем 'provider_unlimited_attempts_not_supported'.
//
// `number_payment_attempts` НИКОГДА не опускается для unlimited — иначе провайдер
// применит собственный default 3 (см. плановые заметки).

export type BepaidAttemptsCapability =
  | { strategy: 'native_zero'; proven: true; proven_at?: string }
  | { strategy: 'large_sentinel'; proven: true; value: number; proven_at?: string }
  | { strategy: 'not_supported'; proven: true; proven_at?: string }
  | null
  | undefined;

export type BepaidAttemptsResolution =
  | { mode: 'limited'; payloadValue: number; provider_strategy: 'explicit_limit' }
  | { mode: 'unlimited_requested'; payloadValue: 0; provider_strategy: 'native_zero' }
  | {
      mode: 'unlimited_requested';
      payloadValue: number;
      provider_strategy: 'verified_large_sentinel';
    };

export class ProviderUnlimitedAttemptsNotSupportedError extends Error {
  code = 'provider_unlimited_attempts_not_supported' as const;
  constructor(public readonly reason: string) {
    super(`provider_unlimited_attempts_not_supported: ${reason}`);
  }
}

export function resolveBepaidAttemptsValue(args: {
  retryPolicy: InstallmentRetryPolicy;
  capability: BepaidAttemptsCapability;
}): BepaidAttemptsResolution {
  const { retryPolicy, capability } = args;

  if (retryPolicy.mode === 'limited') {
    return {
      mode: 'limited',
      payloadValue: retryPolicy.max_attempts,
      provider_strategy: 'explicit_limit',
    };
  }

  // unlimited_requested: capability gate.
  if (!capability || capability.proven !== true) {
    throw new ProviderUnlimitedAttemptsNotSupportedError('capability_not_proven');
  }
  if (capability.strategy === 'not_supported') {
    throw new ProviderUnlimitedAttemptsNotSupportedError('provider_declared_not_supported');
  }
  if (capability.strategy === 'native_zero') {
    return {
      mode: 'unlimited_requested',
      payloadValue: 0,
      provider_strategy: 'native_zero',
    };
  }
  if (capability.strategy === 'large_sentinel') {
    const v = Number(capability.value);
    if (!Number.isInteger(v) || v < 100) {
      throw new ProviderUnlimitedAttemptsNotSupportedError('invalid_large_sentinel_value');
    }
    return {
      mode: 'unlimited_requested',
      payloadValue: v,
      provider_strategy: 'verified_large_sentinel',
    };
  }

  throw new ProviderUnlimitedAttemptsNotSupportedError('unknown_capability_strategy');
}
