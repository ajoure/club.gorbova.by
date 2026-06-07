/**
 * Shared client-side helper для replace-subscription flow.
 *
 * PATCH PAYMENT-CONFLICT v3 — два режима:
 *
 *   1. provider_managed:
 *      - есть provider_subscription_id / bepaid_subscription_id ИЛИ
 *      - runtime-проверка нашла запись в provider_subscriptions
 *      → ОБЯЗАТЕЛЬНО вызываем bepaid-cancel-subscriptions.
 *      → При failure — STOP, новая оплата не создаётся.
 *      → Затем status='superseded', auto_renew=false, audit.
 *
 *   2. local_only_no_provider_subscription:
 *      - нет provider_id в conflict-объекте
 *      - И runtime-проверка подтверждает отсутствие записи в provider_subscriptions
 *      → Без provider cancel. Сразу status='superseded', auto_renew=false.
 *      → Audit с явным replacement_mode='local_only_no_provider_subscription'.
 *
 * Никакого silent fallback. Режим виден в audit_logs.
 */
import { supabase } from "@/integrations/supabase/client";

export interface SubscriptionConflictInfo {
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

export interface CancelOldSubscriptionParams {
  conflict: SubscriptionConflictInfo;
  source: string; // "admin_replace" | "public_checkout_replace" и т.п.
  targetUserId?: string | null;
}

export type ReplacementMode = 'provider_managed' | 'local_only_no_provider_subscription';

/**
 * Runtime-проверка provider-связи (не доверяем только полям из conflict-объекта).
 * Возвращает true если у subscription_v2_id есть active/pending запись в provider_subscriptions.
 */
async function hasProviderLinkage(subscriptionV2Id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('provider_subscriptions')
    .select('id')
    .eq('subscription_v2_id', subscriptionV2Id)
    .in('state', ['active', 'pending'])
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[replacement] provider_subscriptions probe failed (treat as has-linkage)', error);
    // Fail-closed: при ошибке считаем, что provider-связь есть → пройдёт через provider_managed.
    return true;
  }
  return !!data;
}

/**
 * Отменяет старую подписку и помечает её superseded.
 * Режим выбирается автоматически по реальному состоянию provider_subscriptions.
 * Бросает Error при сбое — caller обязан остановить flow и НЕ создавать новую оплату.
 */
export async function cancelOldSubscriptionForReplacement(
  params: CancelOldSubscriptionParams
): Promise<{ mode: ReplacementMode }> {
  const { conflict, source, targetUserId } = params;
  const subV2Id = conflict.subscription_v2_id;

  // --- 1. Определение режима: conflict-поля + runtime probe ---
  const hasProviderIdInConflict =
    !!conflict.provider_subscription_id || !!conflict.bepaid_subscription_id;
  const hasProviderRow = hasProviderIdInConflict
    ? true
    : await hasProviderLinkage(subV2Id);

  const mode: ReplacementMode = hasProviderRow
    ? 'provider_managed'
    : 'local_only_no_provider_subscription';

  console.log('[replacement] mode determined', {
    sub_v2_id: subV2Id, mode,
    hasProviderIdInConflict, hasProviderRow, source,
  });

  // --- 2. Provider cancel (только для provider_managed) ---
  let cancelResult: unknown = null;
  let remoteMissingTreatedAsCanceled = false;
  if (mode === 'provider_managed') {
    const { data: cancelData, error: cancelError } = await supabase.functions.invoke(
      "bepaid-cancel-subscriptions",
      { body: { subscription_v2_id: subV2Id, source } }
    );
    if (cancelError) {
      console.error('[replacement] provider cancel error', cancelError);
      throw new Error("Не удалось отменить текущую подписку у провайдера. Попробуйте позже.");
    }
    // Hotfix-2 (Phase 8 plan §HOTFIX-2): edge явно возвращает remote_missing[] для случая,
    // когда bePaid 404, а локально подписка ещё active/pending/past_due. Это не блокирует
    // replace. Дополнительная страховка: failed[].reason_code === 'not_found' или
    // 'provider_subscription_not_found_treated_as_canceled' тоже трактуем как success.
    const remoteMissingHere =
      Array.isArray(cancelData?.remote_missing) && cancelData.remote_missing.length > 0;
    const failedHard = Array.isArray(cancelData?.failed)
      ? cancelData.failed.filter((f: { reason_code?: string }) =>
          f?.reason_code !== 'not_found'
          && f?.reason_code !== 'provider_subscription_not_found_treated_as_canceled',
        )
      : [];
    if (failedHard.length > 0) {
      const reason = failedHard[0]?.error || "неизвестная ошибка";
      throw new Error(`Провайдер не смог отменить подписку: ${reason}`);
    }
    remoteMissingTreatedAsCanceled = remoteMissingHere;
    cancelResult = cancelData;
  }

  // --- 3. Перевод в superseded (оба режима) ---
  const { error: updateErr } = await supabase
    .from("subscriptions_v2")
    .update({ status: "superseded", auto_renew: false })
    .eq("id", subV2Id);
  if (updateErr) {
    console.error("[replacement] Failed to mark old sub as superseded:", updateErr);
  }

  // --- 4. Audit (mode виден явно) ---
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("audit_logs").insert([{
    actor_type: "user",
    actor_user_id: currentUser?.id || null,
    target_user_id: targetUserId ?? currentUser?.id ?? null,
    action: "subscription.replace_started",
    meta: {
      old_subscription_v2_id: subV2Id,
      product_id: conflict.product_id,
      tariff_id: conflict.tariff_id,
      old_bepaid_subscription_id: conflict.bepaid_subscription_id,
      replacement_mode: mode,
      cancel_result: cancelResult as never,
      source,
    },
  }]);
  if (auditErr) console.error("[replacement] replace_started audit insert failed:", auditErr);

  return { mode };
}
