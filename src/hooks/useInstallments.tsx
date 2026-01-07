import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface InstallmentPayment {
  id: string;
  subscription_id: string;
  order_id: string;
  payment_plan_id: string | null;
  user_id: string;
  payment_number: number;
  total_payments: number;
  amount: number;
  currency: string;
  due_date: string;
  paid_at: string | null;
  status: string;
  payment_id: string | null;
  error_message: string | null;
  charge_attempts: number;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  meta: Record<string, any> | null;
}

export interface InstallmentWithDetails extends InstallmentPayment {
  subscriptions_v2?: {
    id: string;
    status: string;
    products_v2?: { name: string; code: string } | null;
    tariffs?: { name: string; code: string } | null;
  } | null;
  profiles?: {
    email: string | null;
    full_name: string | null;
    phone: string | null;
  } | null;
}

// Fetch all installments for admin
export function useAdminInstallments(status?: string) {
  return useQuery({
    queryKey: ["admin-installments", status],
    queryFn: async () => {
      let query = supabase
        .from("installment_payments")
        .select(`
          *,
          subscriptions_v2 (
            id, status,
            products_v2 ( name, code ),
            tariffs ( name, code )
          )
        `)
        .order("due_date", { ascending: true });

      if (status && status !== "all") {
        if (status === "overdue") {
          query = query
            .eq("status", "pending")
            .lt("due_date", new Date().toISOString());
        } else {
          query = query.eq("status", status);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch profiles separately
      const userIds = [...new Set((data || []).map(i => i.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, email, full_name, phone")
        .in("user_id", userIds);

      const profilesMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      return (data || []).map(item => ({
        ...item,
        profiles: profilesMap.get(item.user_id) || null,
      })) as InstallmentWithDetails[];
    },
  });
}

// Fetch installments for a specific subscription
export function useSubscriptionInstallments(subscriptionId?: string) {
  return useQuery({
    queryKey: ["subscription-installments", subscriptionId],
    queryFn: async () => {
      if (!subscriptionId) return [];
      const { data, error } = await supabase
        .from("installment_payments")
        .select("*")
        .eq("subscription_id", subscriptionId)
        .order("payment_number", { ascending: true });

      if (error) throw error;
      return data as InstallmentPayment[];
    },
    enabled: !!subscriptionId,
  });
}

// Fetch pending installments for a user (used to check if card can be unlinked)
export function useUserPendingInstallments(userId?: string) {
  return useQuery({
    queryKey: ["user-pending-installments", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("installment_payments")
        .select("id, amount, due_date, currency")
        .eq("user_id", userId)
        .eq("status", "pending");

      if (error) throw error;
      return data as Pick<InstallmentPayment, "id" | "amount" | "due_date" | "currency">[];
    },
    enabled: !!userId,
  });
}

// Charge a specific installment
export function useChargeInstallment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (installmentId: string) => {
      const { data, error } = await supabase.functions.invoke("admin-manual-charge", {
        body: { 
          action: "charge_installment",
          installment_id: installmentId 
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Ошибка списания");
      return data;
    },
    onSuccess: () => {
      toast.success("Платёж успешно списан");
      queryClient.invalidateQueries({ queryKey: ["admin-installments"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-installments"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });
}

// Close installment plan early
export function useCloseInstallmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ subscriptionId, reason }: { subscriptionId: string; reason?: string }) => {
      const { error } = await supabase
        .from("installment_payments")
        .update({ 
          status: "cancelled",
          meta: { cancelled_reason: reason || "Досрочное закрытие" }
        })
        .eq("subscription_id", subscriptionId)
        .eq("status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Рассрочка закрыта");
      queryClient.invalidateQueries({ queryKey: ["admin-installments"] });
      queryClient.invalidateQueries({ queryKey: ["subscription-installments"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });
}
