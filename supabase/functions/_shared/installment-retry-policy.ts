// PATCH INSTALLMENT-RETRY-POLICY: единственный парсер политики повторных попыток.
//
// Каноническая бизнес-семантика (см. .lovable/plan.md Этап A4):
//   • отсутствует / null / ''      → mode='provider_default' (payloadValue=3);
//                                    bePaid ретраит по дефолту 3 раза, capability gate не требуется;
//   • явный 0                       → mode='unlimited_requested' (требует provider capability proof);
//   • 1..10                         → mode='limited' с точным конечным лимитом;
//   • всё остальное                 → ошибка.
//
// ВАЖНО: `unlimited_requested` НЕ гарантирует бесконечные попытки на стороне bePaid.
// Документация bePaid однозначно указывает: если number_payment_attempts опущен,
// применяется default 3. Значение 0 как «без ограничения» в публичной документации
// не описано. Поэтому production checkout ДОЛЖЕН пройти capability gate до любых
// mutations (см. resolveBepaidAttemptsValue) при mode='unlimited_requested'.
// Без proof — controlled error `provider_unlimited_attempts_not_supported`.

export type InstallmentRetryPolicy =
  | {
      mode: 'provider_default';
      configured_value: null;
      max_attempts: 3;
    }
  | {
      mode: 'unlimited_requested';
      configured_value: 0;
    }
  | {
      mode: 'limited';
      configured_value: number;
      max_attempts: number;
    };

export const PROVIDER_DEFAULT_ATTEMPTS = 3 as const;

export function resolveInstallmentRetryPolicy(raw: unknown): InstallmentRetryPolicy {
  if (raw === null || raw === undefined || raw === '') {
    return { mode: 'provider_default', configured_value: null, max_attempts: PROVIDER_DEFAULT_ATTEMPTS };
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
// Стратегии:
//   • provider_default             → payloadValue = 3 (bePaid встроенный дефолт);
//   • limited                      → payloadValue = policy.max_attempts;
//   • unlimited_requested + capability='native_zero'
//                                  → payloadValue = 0 (native infinite);
//   • unlimited_requested + capability={strategy:'large_sentinel', value:N}
//                                  → payloadValue = N;
//   • unlimited_requested + capability отсутствует / not_proven
//                                  → бросаем 'provider_unlimited_attempts_not_supported'.
//
// `number_payment_attempts` НИКОГДА не опускается для unlimited — иначе провайдер
// применит собственный default 3.

export type BepaidAttemptsCapability =
  | { strategy: 'native_zero'; proven: true; proven_at?: string }
  | { strategy: 'large_sentinel'; proven: true; value: number; proven_at?: string }
  | { strategy: 'not_supported'; proven: true; proven_at?: string }
  | null
  | undefined;

export type BepaidAttemptsResolution =
  | { mode: 'provider_default'; payloadValue: 3; provider_strategy: 'provider_default'; capability_proven: false }
  | { mode: 'limited'; payloadValue: number; provider_strategy: 'explicit_limit'; capability_proven: false }
  | { mode: 'unlimited_requested'; payloadValue: 0; provider_strategy: 'native_zero'; capability_proven: true; capability_proven_at?: string }
  | { mode: 'unlimited_requested'; payloadValue: number; provider_strategy: 'verified_large_sentinel'; capability_proven: true; capability_proven_at?: string };

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

  if (retryPolicy.mode === 'provider_default') {
    return {
      mode: 'provider_default',
      payloadValue: PROVIDER_DEFAULT_ATTEMPTS,
      provider_strategy: 'provider_default',
      capability_proven: false,
    };
  }

  if (retryPolicy.mode === 'limited') {
    return {
      mode: 'limited',
      payloadValue: retryPolicy.max_attempts,
      provider_strategy: 'explicit_limit',
      capability_proven: false,
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
      capability_proven: true,
      capability_proven_at: capability.proven_at,
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
      capability_proven: true,
      capability_proven_at: capability.proven_at,
    };
  }

  throw new ProviderUnlimitedAttemptsNotSupportedError('unknown_capability_strategy');
}

/**
 * Универсальный snapshot retry-policy для сохранения в orders_v2 / subscriptions_v2 /
 * provider_subscriptions.meta и audit-логи. Единый формат для всех сущностей.
 */
export function buildRetryPolicySnapshot(args: {
  retryPolicy: InstallmentRetryPolicy;
  resolution: BepaidAttemptsResolution;
  capabilitySource?: string;
}): Record<string, unknown> {
  const { retryPolicy, resolution, capabilitySource } = args;
  return {
    mode: retryPolicy.mode,
    configured_value:
      retryPolicy.mode === 'provider_default'
        ? null
        : retryPolicy.mode === 'unlimited_requested'
        ? 0
        : retryPolicy.configured_value,
    provider_strategy: resolution.provider_strategy,
    provider_number_payment_attempts: resolution.payloadValue,
    capability_proven: resolution.capability_proven,
    capability_source: capabilitySource ?? 'integration_instances.config.subscription_attempts_capability',
    resolved_at: new Date().toISOString(),
  };
}
