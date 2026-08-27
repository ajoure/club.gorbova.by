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
 * 4. Resolve TG revoke targets (only if no other active deals)
 * 5. Delete access_grant_ledger
 * 6. Delete entitlements
 * 7. Delete payments_v2
 * 8. Delete orders_v2
 * 9. Revoke TG access through the canonical function
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

      // Resolve revoke targets now, but invoke only after the orders are gone.
      // Otherwise the canonical remaining-access guard still sees the paid
      // order being deleted and correctly blocks the revoke.
      const revokeTargets = new Map<string, { userId: string; clubId: string; orderNumber: string }>();
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
            const targetKey = `${order.user_id}:${product.telegram_club_id}`;
            revokeTargets.set(targetKey, {
              userId: order.user_id,
              clubId: product.telegram_club_id,
              orderNumber: order.order_number,
            });
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

      // Step A: Collect all payment IDs for the target orders
      const { data: paymentsToDelete, error: paymentsFetchError } = await supabase
        .from("payments_v2")
        .select("id")
        .in("order_id", ids);

      if (paymentsFetchError) {
        console.error("[BulkDelete] Failed to fetch payment IDs:", paymentsFetchError);
        throw new Error(`Не удалось получить платежи: ${paymentsFetchError.message}`);
      }

      const paymentIds = paymentsToDelete?.map(p => p.id) || [];
      console.log(`[BulkDelete] Step A: Found ${paymentIds.length} payments for ${ids.length} orders`);

      if (paymentIds.length > 0) {
        // Step B: Nullify ALL inbound references pointing to these payment IDs
        const { count: nullifiedCount, error: nullifyError } = await supabase
          .from("payments_v2")
          .update({ reference_payment_id: null })
          .in("reference_payment_id", paymentIds);

        if (nullifyError) {
          console.error("[BulkDelete] Failed to nullify inbound payment refs:", nullifyError);
          throw new Error(`Не удалось разорвать ссылки платежей: ${nullifyError.message}`);
        }
        console.log(`[BulkDelete] Step B: Nullified ${nullifiedCount ?? '?'} inbound references`);

        // Step C: Delete payments
        const { error: paymentsError, count: deletedPaymentsCount } = await supabase
          .from("payments_v2")
          .delete()
          .in("order_id", ids);

        if (paymentsError) {
          console.error("[BulkDelete] CRITICAL: Failed to delete payments:", paymentsError);
          throw new Error(`Не удалось удалить платежи: ${paymentsError.message}. Код: ${paymentsError.code}`);
        }
        console.log(`[BulkDelete] Step C: Deleted ${deletedPaymentsCount ?? '?'} payments`);
      } else {
        console.log(`[BulkDelete] No payments found, skipping payment cleanup`);
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

      // Canonical revoke also sends the customer notification. Re-check
      // remaining commercial access inside the function to protect against a
      // concurrent purchase between target resolution and this invocation.
      let revokeFailures = 0;
      for (const target of revokeTargets.values()) {
        const { data: revokeResult, error: revokeError } = await supabase.functions.invoke(
          "telegram-revoke-access",
          {
            body: {
              user_id: target.userId,
              club_id: target.clubId,
              reason: "deal_deleted",
              is_manual: true,
              respect_remaining_access: true,
            },
          },
        );

        if (revokeError || revokeResult?.error) {
          revokeFailures += 1;
          console.warn(
            `[BulkDelete] Telegram revoke failed for ${target.orderNumber}:`,
            revokeError || revokeResult,
          );
        } else if (revokeResult?.blocked) {
          console.info(
            `[BulkDelete] Telegram revoke safely blocked for ${target.orderNumber}: remaining access exists`,
          );
        }
      }

      return { deleted: ids.length, revokeFailures };
    },
    onSuccess: (result) => {
      toast.success(`Удалено ${result.deleted} сделок`);
      if (result.revokeFailures > 0) {
        toast.warning(
          `Удаление завершено, но Telegram-доступ не удалось закрыть для ${result.revokeFailures} записей`,
        );
      }
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
