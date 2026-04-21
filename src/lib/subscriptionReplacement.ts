/**
 * Shared client-side helper для replace-subscription flow.
 *
 * Используется и в admin (`AdminPaymentLinkDialog`), и в public
 * (`PaymentDialog`) точках оплаты, чтобы канонический сценарий
 * (cancel → superseded → audit) не дублировался.
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

/**
 * Отменяет старую подписку у провайдера, помечает её superseded,
 * пишет audit. Бросает Error при сбое — caller обязан остановить flow
 * и НЕ создавать новую оплату.
 */
export async function cancelOldSubscriptionForReplacement(
  params: CancelOldSubscriptionParams
): Promise<void> {
  const { conflict, source, targetUserId } = params;
  const subV2Id = conflict.subscription_v2_id;

  // 1. Cancel у провайдера.
  const { data: cancelData, error: cancelError } = await supabase.functions.invoke(
    "bepaid-cancel-subscriptions",
    { body: { subscription_v2_id: subV2Id, source } }
  );
  if (cancelError) {
    throw new Error("Не удалось отменить текущую подписку у провайдера. Попробуйте позже.");
  }
  if (cancelData?.failed?.length > 0) {
    const reason = cancelData.failed[0]?.error || "неизвестная ошибка";
    throw new Error(`Провайдер не смог отменить подписку: ${reason}`);
  }

  // 2. Перевод в superseded.
  const { error: updateErr } = await supabase
    .from("subscriptions_v2")
    .update({ status: "superseded", auto_renew: false })
    .eq("id", subV2Id);
  if (updateErr) {
    console.error("[replacement] Failed to mark old sub as superseded:", updateErr);
  }

  // 3. Audit.
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("audit_logs").insert({
    actor_type: "user",
    actor_user_id: currentUser?.id || null,
    target_user_id: targetUserId ?? currentUser?.id ?? null,
    action: "subscription.replace_started",
    meta: {
      old_subscription_v2_id: subV2Id,
      product_id: conflict.product_id,
      tariff_id: conflict.tariff_id,
      old_bepaid_subscription_id: conflict.bepaid_subscription_id,
      cancel_result: cancelData,
      source,
    },
  });
  if (auditErr) console.error("[replacement] replace_started audit insert failed:", auditErr);
}
