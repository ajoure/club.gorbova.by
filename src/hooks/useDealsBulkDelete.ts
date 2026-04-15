import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Shared bulk delete hook — single delete flow for both list-view and kanban.
 * Extracted from AdminDeals.tsx inline mutation.
 *
 * Flow:
 * 1. Cancel GetCourse for paid orders
 * 2. Delete installment_schedules
 * 3. Delete subscriptions_v2
 * 4. Revoke TG access (only if no other active deals)
 * 5. Delete access_grant_ledger
 * 6. Delete entitlements
 * 7. Delete payments_v2
 * 8. Delete orders_v2
 * 9. Send revoked notifications
 */
export function useDealsBulkDelete(opts?: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      console.log(`[BulkDelete] Starting deletion of ${ids.length} orders:`, ids);

      const { data: ordersToDelete, error: fetchError } = await supabase
        .from("orders_v2")
        .select("id, user_id, product_id, order_number, status, customer_email, products_v2(name, code, telegram_club_id)")
        .in("id", ids);

      if (fetchError) {
        console.error("[BulkDelete] Failed to fetch orders for deletion:", fetchError);
        throw new Error(`Не удалось получить данные сделок: ${fetchError.message}`);
      }

      if (!ordersToDelete || ordersToDelete.length === 0) {
        throw new Error("Сделки не найдены или уже удалены");
      }

      console.log(`[BulkDelete] Found ${ordersToDelete.length} orders to delete`);

      // Cancel GetCourse for paid orders
      for (const order of ordersToDelete) {
        if (order.status === "paid") {
          console.log(`[BulkDelete] Canceling GetCourse for order ${order.order_number}`);
          await supabase.functions.invoke("getcourse-cancel-deal", {
            body: { order_id: order.id, reason: "deal_deleted_by_admin" },
          }).catch(e => console.warn("[BulkDelete] GetCourse cancel failed:", e));
        }
      }

      // Fetch subscriptions
      const { data: subscriptions, error: subsQueryError } = await supabase
        .from("subscriptions_v2")
        .select("id")
        .in("order_id", ids);

      if (subsQueryError) {
        console.error("[BulkDelete] Error fetching subscriptions:", subsQueryError);
      }

      const subscriptionIds = subscriptions?.map(s => s.id) || [];
      console.log(`[BulkDelete] Found ${subscriptionIds.length} subscriptions to delete`);

      const uniqueUserIds = [...new Set(ordersToDelete.filter(o => o.user_id).map(o => o.user_id!))];

      if (subscriptionIds.length > 0) {
        const { error: installmentsError } = await (supabase as any)
          .from("installment_schedules")
          .delete()
          .in("subscription_id", subscriptionIds);
        if (installmentsError) {
          console.error("[BulkDelete] Error deleting installments:", installmentsError);
        }

        const { error: subscriptionsError } = await supabase
          .from("subscriptions_v2")
          .delete()
          .in("id", subscriptionIds);
        if (subscriptionsError) {
          console.error("[BulkDelete] Error deleting subscriptions:", subscriptionsError);
          throw new Error(`Ошибка удаления подписок: ${subscriptionsError.message}`);
        }
        console.log(`[BulkDelete] Deleted ${subscriptionIds.length} subscriptions`);
      }

      // Revoke TG access for users with no other active deals
      for (const order of ordersToDelete) {
        const product = order.products_v2 as any;
        if (product?.telegram_club_id && order.user_id) {
          const { count: otherActiveDeals } = await supabase
            .from("orders_v2")
            .select("*", { count: "exact", head: true })
            .eq("user_id", order.user_id)
            .eq("status", "paid")
            .not("id", "in", `(${ids.join(",")})`);

          const { count: activeSubscriptions } = await supabase
            .from("subscriptions_v2")
            .select("*", { count: "exact", head: true })
            .eq("user_id", order.user_id)
            .eq("status", "active");

          if ((otherActiveDeals || 0) === 0 && (activeSubscriptions || 0) === 0) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("telegram_user_id")
              .eq("user_id", order.user_id)
              .single();

            if (prof?.telegram_user_id) {
              supabase.functions.invoke("telegram-club-access", {
                body: {
                  action: "revoke",
                  telegram_user_id: prof.telegram_user_id,
                  telegram_club_id: product.telegram_club_id,
                  reason: "deal_deleted",
                },
              }).catch(console.error);
            }
          } else {
            console.log(`[BulkDelete] Skipping TG revoke for ${order.order_number}: user has ${otherActiveDeals} other deals, ${activeSubscriptions} active subs`);
          }
        }
      }

      // Delete access ledger entries
      const { error: ledgerError } = await supabase
        .from("access_grant_ledger")
        .delete()
        .in("order_id", ids);
      if (ledgerError) console.error("[BulkDelete] Error deleting ledger entries:", ledgerError);

      // Delete entitlements
      const { error: entError } = await supabase
        .from("entitlements")
        .delete()
        .in("order_id", ids);
      if (entError) console.error("[BulkDelete] Error deleting entitlements:", entError);

      // Step 1: Nullify self-references to avoid FK violation (refunds/chargebacks referencing parent payments)
      const { count: nullifiedCount, error: nullifyError } = await supabase
        .from("payments_v2")
        .update({ reference_payment_id: null })
        .in("order_id", ids);
      if (nullifyError) {
        console.error("[BulkDelete] Error nullifying payment references:", nullifyError);
      } else {
        console.log(`[BulkDelete] Nullified reference_payment_id for ${nullifiedCount ?? '?'} payments`);
      }

      // Step 2: Delete payments
      const { error: paymentsError, count: deletedPaymentsCount } = await supabase
        .from("payments_v2")
        .delete()
        .in("order_id", ids);
      if (paymentsError) {
        console.error("[BulkDelete] Error deleting payments:", paymentsError);
      } else {
        console.log(`[BulkDelete] Deleted ${deletedPaymentsCount ?? '?'} payments for orders`);
      }

      // Delete orders
      console.log(`[BulkDelete] Attempting to delete orders:`, ids);
      const { error, count } = await supabase
        .from("orders_v2")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("[BulkDelete] CRITICAL: Failed to delete orders:", error);
        throw new Error(`Не удалось удалить сделки: ${error.message}. Код: ${error.code}`);
      }

      console.log(`[BulkDelete] Successfully deleted orders, count:`, count);

      // Send notifications
      for (const userId of uniqueUserIds) {
        supabase.functions.invoke("send-access-revoked-notification", {
          body: { user_id: userId, reason: "deal_deleted" },
        }).catch(console.error);
      }

      return { deleted: ids.length };
    },
    onSuccess: (result) => {
      toast.success(`Удалено ${result.deleted} сделок`);
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["admin-deals-tab-counts"] });
      queryClient.invalidateQueries({ queryKey: ["deals-board"] });
      opts?.onSuccess?.();
    },
    onError: (error: any) => {
      console.error("[BulkDelete] Delete mutation error:", error);
      toast.error("Ошибка удаления: " + (error?.message || String(error)));
    },
  });
}
