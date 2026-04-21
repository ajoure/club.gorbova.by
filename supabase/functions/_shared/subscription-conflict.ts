/**
 * Shared helper: subscription duplicate guard и replacement validation.
 *
 * SOT для двух точек создания подписочного checkout:
 *   - supabase/functions/_shared/create-payment-checkout.ts (admin / token-flow)
 *   - supabase/functions/bepaid-create-subscription-checkout/index.ts (provider-managed)
 *
 * Бизнес-правило (зафиксировано в memory):
 *   Конфликт = same user_id + same product_id + same tariff_id
 *              + status in CONFLICTING_STATUSES.
 *   Подписки на ДРУГОЙ продукт или ДРУГОЙ тариф конфликтом не являются.
 *
 * Replacement (`replacement_of_subscription_v2_id`) разрешён ТОЛЬКО когда:
 *   - Старая подписка реально отменена и переведена в один из TERMINAL_STATUSES.
 *   - Старая подписка принадлежит тому же user_id + product_id + tariff_id.
 *   - На момент вызова реально существует same-pair conflict (либо подписка
 *     уже стала terminal — тогда replacement используется как явная привязка
 *     истории; конфликта на этот момент уже нет, но product/tariff/user
 *     совпадают, что уже проверено).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

type SupabaseClient = ReturnType<typeof createClient>;

/** Статусы, которые блокируют новую покупку same-pair. */
export const CONFLICTING_STATUSES = ['active', 'trial', 'past_due'] as const;

/** Финальные статусы, разрешённые для заменяемой подписки. */
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
 * Проверка exact-pair конфликта. Используется ОБЕИМИ точками создания подписки.
 * fail-closed: при ошибке запроса возвращает `error` — caller обязан остановить flow.
 */
export async function checkSubscriptionConflict(
  supabase: SupabaseClient,
  params: { user_id: string; product_id: string; tariff_id: string },
): Promise<ConflictCheckResult> {
  const { user_id, product_id, tariff_id } = params;

  if (!user_id || !product_id || !tariff_id) {
    return { status: 'error', error: 'Missing required fields for conflict check' };
  }

  const { data: existingSub, error: guardError } = await supabase
    .from('subscriptions_v2')
    .select('id, status, access_end_at, next_charge_at, billing_type, product_id, tariff_id')
    .eq('user_id', user_id)
    .eq('product_id', product_id)
    .eq('tariff_id', tariff_id)
    .in('status', CONFLICTING_STATUSES as unknown as string[])
    .limit(1)
    .maybeSingle();

  if (guardError) {
    console.error('[subscription-conflict] guard query failed (fail-closed)', guardError);
    return { status: 'error', error: 'Ошибка проверки существующих подписок. Повторите попытку.' };
  }

  if (!existingSub) {
    return { status: 'no_conflict' };
  }

  // Подтягиваем provider id (если есть активный/pending у провайдера).
  let bepaidSubscriptionId: string | null = null;
  let providerSubscriptionId: string | null = null;
  const { data: provSub } = await supabase
    .from('provider_subscriptions')
    .select('provider_subscription_id, state')
    .eq('subscription_v2_id', existingSub.id)
    .eq('provider', 'bepaid')
    .in('state', ['active', 'pending'])
    .limit(1)
    .maybeSingle();
  if (provSub) {
    bepaidSubscriptionId = provSub.provider_subscription_id;
    providerSubscriptionId = provSub.provider_subscription_id;
  }

  return {
    status: 'conflict',
    conflict: {
      subscription_v2_id: existingSub.id,
      status: existingSub.status,
      next_charge_at: existingSub.next_charge_at,
      access_end_at: existingSub.access_end_at,
      bepaid_subscription_id: bepaidSubscriptionId,
      provider_subscription_id: providerSubscriptionId,
      product_id: existingSub.product_id,
      tariff_id: existingSub.tariff_id,
      display_next_charge_at: formatForDisplay(existingSub.next_charge_at),
      display_access_end_at: formatForDisplay(existingSub.access_end_at),
      timezone_used: TZ,
    },
  };
}

export type ReplacementValidationResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

/**
 * Валидация replacement_of_subscription_v2_id:
 *   - подписка существует;
 *   - принадлежит тому же user_id + product_id + tariff_id;
 *   - находится в TERMINAL_STATUSES.
 */
export async function validateReplacementSubscription(
  supabase: SupabaseClient,
  params: {
    replacement_of_subscription_v2_id: string;
    user_id: string;
    product_id: string;
    tariff_id: string;
  },
): Promise<ReplacementValidationResult> {
  const { replacement_of_subscription_v2_id, user_id, product_id, tariff_id } = params;

  const { data: oldSub, error: oldSubErr } = await supabase
    .from('subscriptions_v2')
    .select('id, status, user_id, product_id, tariff_id')
    .eq('id', replacement_of_subscription_v2_id)
    .maybeSingle();

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

  if (oldSub.tariff_id !== tariff_id) {
    console.error('[subscription-conflict] replacement: tariff mismatch', {
      replacement_of_subscription_v2_id, expected_tariff: tariff_id, actual_tariff: oldSub.tariff_id,
    });
    return { status: 'error', error: 'Заменяемая подписка относится к другому тарифу.' };
  }

  if (!(TERMINAL_STATUSES as unknown as string[]).includes(oldSub.status)) {
    console.error('[subscription-conflict] replacement: not terminal', {
      replacement_of_subscription_v2_id, status: oldSub.status,
    });
    return {
      status: 'error',
      error: `Заменяемая подписка ещё не отменена (статус: ${oldSub.status}). Сначала отмените её у провайдера.`,
    };
  }

  return { status: 'ok' };
}
