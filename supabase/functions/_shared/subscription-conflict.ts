/**
 * Shared helper: subscription duplicate guard и replacement validation.
 *
 * SOT для двух точек создания подписочного checkout:
 *   - supabase/functions/_shared/create-payment-checkout.ts (admin / token-flow)
 *   - supabase/functions/bepaid-create-subscription-checkout/index.ts (provider-managed)
 *
 * === БИЗНЕС-ПРАВИЛО (PATCH PAYMENT-CONFLICT v3) ===
 *
 * Конфликт = same user_id + same product_id
 *          + status in CONFLICTING_STATUSES
 *          + provider-managed nature подтверждена.
 *
 * Provider-managed nature = существует строка в `provider_subscriptions`
 * для этой `subscription_v2_id` (provider id-полей в `subscriptions_v2` не существует).
 *
 * - tariff_id, amount, price НЕ участвуют в conflict detection.
 * - Локальные active-записи без provider-связи — это data anomalies, не блокеры.
 * - Replacement разрешён между разными тарифами одного продукта.
 * - "Подписка" = bePaid recurrent subscription (provider-managed).
 *
 * Replacement (`replacement_of_subscription_v2_id`) разрешён ТОЛЬКО когда:
 *   - Старая подписка существует;
 *   - Принадлежит тому же user_id + product_id (tariff может отличаться);
 *   - Находится в одном из TERMINAL_STATUSES.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

type SupabaseClient = ReturnType<typeof createClient>;

/** Статусы, которые блокируют новую покупку same-product (при наличии provider-связи). */
export const CONFLICTING_STATUSES = ['active', 'trial', 'past_due'] as const;

/** Финальные статусы, разрешённые для заменяемой подписки (из живого enum). */
export const TERMINAL_STATUSES = ['canceled', 'superseded', 'expired', 'expired_reentry'] as const;

export interface SubscriptionConflict {
  subscription_v2_id: string;
  status: string;
  next_charge_at: string | null;
  access_end_at: string | null;
  bepaid_subscription_id: string | null;
  provider_subscription_id: string | null;
  product_id: string;
  tariff_id: string;
  display_next_charge_at: string | null;
  display_access_end_at: string | null;
  timezone_used: string;
}

export type ConflictCheckResult =
  | { status: 'no_conflict' }
  | { status: 'conflict'; conflict: SubscriptionConflict }
  | { status: 'error'; error: string };

const TZ = 'Europe/Minsk';

function formatForDisplay(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Проверка product-level provider-managed конфликта.
 * Алгоритм:
 *   1. Найти все subscriptions_v2 same user + product + status in CONFLICTING_STATUSES.
 *   2. Для каждой проверить наличие записи в provider_subscriptions.
 *   3. Если есть хотя бы одна с provider-связью — это блокирующий конфликт.
 *   4. Если есть только зомби (без provider-связи) — игнорируем (data anomaly).
 *
 * fail-closed: при ошибке запроса возвращает `error` — caller обязан остановить flow.
 */
export async function checkSubscriptionConflict(
  supabase: SupabaseClient,
  params: { user_id: string; product_id: string; tariff_id?: string },
): Promise<ConflictCheckResult> {
  const { user_id, product_id } = params;

  if (!user_id || !product_id) {
    return { status: 'error', error: 'Missing required fields for conflict check (user_id, product_id)' };
  }

  // 1. Все potential conflict-кандидаты по user+product (без фильтра по tariff!).
  const { data: candidates, error: guardError } = await supabase
    .from('subscriptions_v2')
    .select('id, status, access_end_at, next_charge_at, billing_type, product_id, tariff_id, created_at')
    .eq('user_id', user_id)
    .eq('product_id', product_id)
    .in('status', CONFLICTING_STATUSES as unknown as string[])
    .order('created_at', { ascending: false });

  if (guardError) {
    console.error('[subscription-conflict] guard query failed (fail-closed)', guardError);
    return { status: 'error', error: 'Ошибка проверки существующих подписок. Повторите попытку.' };
  }

  if (!candidates || candidates.length === 0) {
    console.log('[subscription-conflict] no candidates (no active/trial/past_due for product)', {
      user_id, product_id,
    });
    return { status: 'no_conflict' };
  }

  // 2. Для каждой проверяем provider-связь — это и есть «настоящая» bePaid-подписка.
  for (const cand of (candidates as any[])) {
    const { data: provSubRaw, error: provErr } = await supabase
      .from('provider_subscriptions')
      .select('provider_subscription_id, state, provider')
      .eq('subscription_v2_id', cand.id as string)
      .eq('provider', 'bepaid')
      .in('state', ['active', 'pending'])
      .limit(1)
      .maybeSingle();

    if (provErr) {
      console.error('[subscription-conflict] provider_subscriptions query failed (fail-closed)', provErr);
      return { status: 'error', error: 'Ошибка проверки провайдерской подписки. Повторите попытку.' };
    }

    const provSub = provSubRaw as any;
    if (provSub) {
      // 3. Provider-managed подписка найдена — это блокирующий конфликт.
      console.log('[subscription-conflict] BLOCKING — provider-managed sub found', {
        subscription_v2_id: cand.id,
        product_id,
        tariff_id: cand.tariff_id,
        bepaid_id: provSub.provider_subscription_id,
        state: provSub.state,
      });
      return {
        status: 'conflict',
        conflict: {
          subscription_v2_id: cand.id as string,
          status: cand.status as string,
          next_charge_at: (cand.next_charge_at as string | null) ?? null,
          access_end_at: (cand.access_end_at as string | null) ?? null,
          bepaid_subscription_id: (provSub.provider_subscription_id as string | null) ?? null,
          provider_subscription_id: (provSub.provider_subscription_id as string | null) ?? null,
          product_id: cand.product_id as string,
          tariff_id: cand.tariff_id as string,
          display_next_charge_at: formatForDisplay((cand.next_charge_at as string | null) ?? null),
          display_access_end_at: formatForDisplay((cand.access_end_at as string | null) ?? null),
          timezone_used: TZ,
        },
      };
    }
  }

  // 4. Все кандидаты — зомби (без provider-связи). Не блокируем.
  console.log('[subscription-conflict] no_conflict — only zombie rows (active without provider linkage)', {
    user_id, product_id, zombie_count: candidates.length,
    zombie_ids: candidates.map((c: any) => c.id),
  });
  return { status: 'no_conflict' };
}

export type ReplacementValidationResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

/**
 * Валидация replacement_of_subscription_v2_id (PATCH PAYMENT-CONFLICT v3):
 *   - подписка существует;
 *   - принадлежит тому же user_id + product_id (tariff МОЖЕТ отличаться);
 *   - находится в одном из TERMINAL_STATUSES.
 *
 * НЕ требует tariff_id match — пользователь может заменить тариф в рамках продукта.
 */
export async function validateReplacementSubscription(
  supabase: SupabaseClient,
  params: {
    replacement_of_subscription_v2_id: string;
    user_id: string;
    product_id: string;
    tariff_id?: string; // принимается для логов, в проверке не участвует
  },
): Promise<ReplacementValidationResult> {
  const { replacement_of_subscription_v2_id, user_id, product_id, tariff_id } = params;

  const { data: oldSubRaw, error: oldSubErr } = await supabase
    .from('subscriptions_v2')
    .select('id, status, user_id, product_id, tariff_id')
    .eq('id', replacement_of_subscription_v2_id)
    .maybeSingle();
  const oldSub = oldSubRaw as
    | { id: string; status: string; user_id: string; product_id: string; tariff_id: string | null }
    | null;

  if (oldSubErr || !oldSub) {
    console.error('[subscription-conflict] replacement subscription not found', {
      replacement_of_subscription_v2_id, error: oldSubErr,
    });
    return { status: 'error', error: 'Не удалось найти заменяемую подписку. Повторите попытку.' };
  }

  if (oldSub.user_id !== user_id) {
    console.error('[subscription-conflict] replacement: user mismatch', {
      replacement_of_subscription_v2_id, expected_user: user_id, actual_user: oldSub.user_id,
    });
    return { status: 'error', error: 'Заменяемая подписка принадлежит другому пользователю.' };
  }

  if (oldSub.product_id !== product_id) {
    console.error('[subscription-conflict] replacement: product mismatch', {
      replacement_of_subscription_v2_id, expected_product: product_id, actual_product: oldSub.product_id,
    });
    return { status: 'error', error: 'Заменяемая подписка относится к другому продукту.' };
  }

  if (!(TERMINAL_STATUSES as unknown as string[]).includes((oldSub as any).status as string)) {
    console.error('[subscription-conflict] replacement: not terminal', {
      replacement_of_subscription_v2_id, status: oldSub.status,
    });
    return {
      status: 'error',
      error: `Заменяемая подписка ещё не отменена (статус: ${oldSub.status}). Сначала отмените её у провайдера.`,
    };
  }

  console.log('[subscription-conflict] replacement validated (product-level, tariff-agnostic)', {
    replacement_of_subscription_v2_id, user_id, product_id,
    new_tariff_id: tariff_id, old_tariff_id: oldSub.tariff_id,
    tariff_changed: tariff_id !== oldSub.tariff_id,
  });
  return { status: 'ok' };
}

// =====================================================================
// PATCH H3.x-a — classifySameProductState (B-2 root-fix)
//
// SOT: same SOT, что и checkSubscriptionConflict — `subscriptions_v2` +
// `provider_subscriptions(provider='bepaid', state in ('active','pending'))`.
// Не заменяет checkSubscriptionConflict (callers оставлены без изменений),
// а добавляет тариф-чувствительную классификацию для writer-ов.
//
// Возможные decisions:
//   - 'no_existing'         — нет provider-managed active/trial/past_due для этого product;
//   - 'extend_same_tariff'  — есть active provider-managed sub с тем же tariff_id;
//   - 'replace_other_tariff'— есть active provider-managed sub другого tariff_id (или tariff_id отсутствует);
//   - 'error'               — fail-closed.
//
// Frontend-friendly outcome (B-2 правка плана #2):
//   при extend_same_tariff writer ОБЯЗАН вернуть already_has_active_subscription
//   и НЕ создавать ни нового orders_v2 subscription-pre-record, ни вызывать bePaid /subscriptions.
// =====================================================================

export type SameProductDecision =
  | 'no_existing'
  | 'extend_same_tariff'
  | 'replace_other_tariff';

export interface ExistingProviderSub {
  subscription_v2_id: string;
  status: string;
  tariff_id: string | null;
  access_end_at: string | null;
  next_charge_at: string | null;
  provider_subscription_id: string | null;
  provider_state: string;
}

export type ClassifyResult =
  | { status: 'ok'; decision: SameProductDecision; existing: ExistingProviderSub | null }
  | { status: 'error'; error: string };

export async function classifySameProductState(
  supabase: SupabaseClient,
  params: { user_id: string; product_id: string; tariff_id: string | null | undefined },
): Promise<ClassifyResult> {
  const { user_id, product_id, tariff_id } = params;

  if (!user_id || !product_id) {
    return { status: 'error', error: 'Missing required fields (user_id, product_id)' };
  }

  const { data: candidates, error: candErr } = await supabase
    .from('subscriptions_v2')
    .select('id, status, tariff_id, access_end_at, next_charge_at, created_at')
    .eq('user_id', user_id)
    .eq('product_id', product_id)
    .in('status', CONFLICTING_STATUSES as unknown as string[])
    .order('created_at', { ascending: false });

  if (candErr) {
    console.error('[classifySameProductState] candidates query failed (fail-closed)', candErr);
    return { status: 'error', error: 'Ошибка проверки существующих подписок.' };
  }

  if (!candidates || candidates.length === 0) {
    return { status: 'ok', decision: 'no_existing', existing: null };
  }

  // Найти первый кандидат, у которого есть provider linkage.
  let sameTariff: ExistingProviderSub | null = null;
  let anyProviderSub: ExistingProviderSub | null = null;

  for (const cand of candidates as any[]) {
    const { data: provRaw, error: provErr } = await supabase
      .from('provider_subscriptions')
      .select('provider_subscription_id, state, provider')
      .eq('subscription_v2_id', cand.id as string)
      .eq('provider', 'bepaid')
      .in('state', ['active', 'pending'])
      .limit(1)
      .maybeSingle();

    if (provErr) {
      console.error('[classifySameProductState] provider_subscriptions query failed (fail-closed)', provErr);
      return { status: 'error', error: 'Ошибка проверки провайдерской подписки.' };
    }

    const prov = provRaw as any;
    if (!prov) continue;

    const candTariffId = (cand.tariff_id as string | null) ?? null;
    const summary: ExistingProviderSub = {
      subscription_v2_id: cand.id as string,
      status: cand.status as string,
      tariff_id: candTariffId,
      access_end_at: (cand.access_end_at as string | null) ?? null,
      next_charge_at: (cand.next_charge_at as string | null) ?? null,
      provider_subscription_id: (prov.provider_subscription_id as string | null) ?? null,
      provider_state: prov.state as string,
    };

    if (!anyProviderSub) anyProviderSub = summary;
    if (tariff_id && candTariffId && candTariffId === tariff_id) {
      sameTariff = summary;
      break;
    }
  }

  if (sameTariff) {
    return { status: 'ok', decision: 'extend_same_tariff', existing: sameTariff };
  }
  if (anyProviderSub) {
    return { status: 'ok', decision: 'replace_other_tariff', existing: anyProviderSub };
  }
  // Только зомби-кандидаты без provider-связи — не блокируем.
  return { status: 'ok', decision: 'no_existing', existing: null };
}

