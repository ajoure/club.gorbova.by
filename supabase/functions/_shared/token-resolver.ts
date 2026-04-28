// ============================================================================
// token-resolver.ts — Stage 1 helper (installment-only scope)
// ----------------------------------------------------------------------------
// Назначение: единая точка получения provider_token для списания по подписке
// в рамках installment-flow (cron рассрочек).
//
// Приоритет источников (Source of Truth для рассрочек):
//   1. payment_methods.provider_token   — основной trusted источник
//   2. subscription_payment_credentials — legacy MIT credentials
//   3. subscriptions_v2.payment_token   — fallback (legacy column)
//
// ВАЖНО:
//   • Этот helper используется ТОЛЬКО installment-charge-cron в рамках Stage 1.
//   • Существующие prod-функции (subscription-charge, admin-manual-charge,
//     bepaid-webhook и др.) НЕ трогаем — отдельный backlog.
//   • Если token найден, но payment_method_id отсутствует — это «ghost token»:
//     пропускаем списание и пишем audit-event (контракт ID-First).
// ============================================================================

export type TokenSource =
  | 'payment_methods'
  | 'subscription_payment_credentials'
  | 'payment_token_fallback';

export interface ResolvedToken {
  token: string;
  source: TokenSource;
  payment_method_id: string | null;
}

export interface ResolveTokenSkip {
  skip: true;
  reason:
    | 'no_subscription'
    | 'subscription_inactive'
    | 'no_token_anywhere'
    | 'ghost_token_no_payment_method'
    | 'payment_method_inactive';
  details?: Record<string, unknown>;
}

export type ResolveTokenResult = ResolvedToken | ResolveTokenSkip;

export function isSkip(r: ResolveTokenResult): r is ResolveTokenSkip {
  return (r as ResolveTokenSkip).skip === true;
}

/**
 * Получить provider_token для подписки по строгому приоритету источников.
 * Используется только installment-flow (Stage 1).
 */
export async function getSubscriptionToken(
  supabase: any,
  subscriptionId: string,
): Promise<ResolveTokenResult> {
  // 1. Загружаем подписку
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions_v2')
    .select('id, status, payment_method_id, payment_token')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (subErr || !sub) {
    return { skip: true, reason: 'no_subscription', details: { subscriptionId, error: subErr?.message } };
  }

  if (!['active', 'trial'].includes(sub.status)) {
    return { skip: true, reason: 'subscription_inactive', details: { status: sub.status } };
  }

  // 2. Приоритет №1: payment_methods (trusted source)
  if (sub.payment_method_id) {
    const { data: pm } = await supabase
      .from('payment_methods')
      .select('id, status, provider_token')
      .eq('id', sub.payment_method_id)
      .maybeSingle();

    if (pm && pm.status === 'active' && pm.provider_token) {
      return {
        token: pm.provider_token,
        source: 'payment_methods',
        payment_method_id: pm.id,
      };
    }

    if (pm && pm.status !== 'active') {
      return {
        skip: true,
        reason: 'payment_method_inactive',
        details: { payment_method_id: pm.id, status: pm.status },
      };
    }
  }

  // 3. Приоритет №2: subscription_payment_credentials (legacy MIT)
  const { data: cred } = await supabase
    .from('subscription_payment_credentials')
    .select('provider_token')
    .eq('subscription_id', subscriptionId)
    .maybeSingle();

  if (cred?.provider_token) {
    // Ghost token guard: токен есть, но payment_method_id не привязан
    if (!sub.payment_method_id) {
      return {
        skip: true,
        reason: 'ghost_token_no_payment_method',
        details: { source: 'subscription_payment_credentials', subscriptionId },
      };
    }
    return {
      token: cred.provider_token,
      source: 'subscription_payment_credentials',
      payment_method_id: sub.payment_method_id,
    };
  }

  // 4. Приоритет №3: subscriptions_v2.payment_token (legacy fallback)
  if (sub.payment_token) {
    if (!sub.payment_method_id) {
      return {
        skip: true,
        reason: 'ghost_token_no_payment_method',
        details: { source: 'payment_token_fallback', subscriptionId },
      };
    }
    return {
      token: sub.payment_token,
      source: 'payment_token_fallback',
      payment_method_id: sub.payment_method_id,
    };
  }

  return { skip: true, reason: 'no_token_anywhere', details: { subscriptionId } };
}
